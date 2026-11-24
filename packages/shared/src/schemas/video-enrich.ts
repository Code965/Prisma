import { z } from 'zod';
import { IdSchema } from './common.js';
import { SHORT_LIMITS, ShortSegmentSchema, type ShortSegment } from './shorts.js';
import {
  BROLL_LIMITS,
  OVERLAY_KINDS,
  OVERLAY_LIMITS,
  limitCode,
  type Overlay,
  type OverlayKind,
} from './video-overlays.js';

/**
 * «Aggiungi B-roll e testi» (fase 6d): l'LLM legge le frasi numerate e propone schede di testo
 * e ricerche di B-roll; il B-roll si cerca nella cartella dell'utente e su Pixabay.
 */

// --- Proposta dell'AI --------------------------------------------------------------------------

export const EnrichRequestSchema = z.object({
  brandId: IdSchema,
  videoTitle: z.string().trim().min(1).max(200),
  durationMs: z.int().positive(),
  segments: z.array(ShortSegmentSchema).min(1).max(SHORT_LIMITS.maxSegments),
});
export type EnrichRequest = z.input<typeof EnrichRequestSchema>;

export const EnrichPlanSchema = z.object({
  overlays: z.array(
    z.object({
      segment: z.int().nonnegative(),
      kind: z.enum(OVERLAY_KINDS),
      title: z.string().trim().min(1).max(OVERLAY_LIMITS.titleMax),
      body: z.string().trim().max(OVERLAY_LIMITS.bodyMax).default(''),
      code: z.string().max(OVERLAY_LIMITS.codeMax).default(''),
    }),
  ),
  broll: z.array(
    z.object({
      segment: z.int().nonnegative(),
      /** Ricerca breve in inglese (gli archivi di immagini sono più ricchi in inglese). */
      query: z.string().trim().min(2).max(60),
    }),
  ),
});
export type EnrichPlan = z.infer<typeof EnrichPlanSchema>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Intervallo di una scheda sulla frase: il titolo all'inizio, codice ed elenchi per tutta la frase. */
export function overlayRange(
  kind: OverlayKind,
  segment: ShortSegment,
): { startMs: number; endMs: number } {
  const length = segment.endMs - segment.startMs;
  const wanted = kind === 'title' ? Math.min(length, OVERLAY_LIMITS.titleMs) : length;
  return {
    startMs: segment.startMs,
    endMs: segment.startMs + clamp(wanted, OVERLAY_LIMITS.minMs, OVERLAY_LIMITS.maxMs),
  };
}

/** Intervallo del B-roll: la frase, tra 1,5 e 8 s. */
export function brollRange(segment: ShortSegment): { startMs: number; endMs: number } {
  const length = clamp(segment.endMs - segment.startMs, BROLL_LIMITS.minMs, BROLL_LIMITS.maxMs);
  return { startMs: segment.startMs, endMs: segment.startMs + length };
}

/** Id breve e stabile per schede e B-roll (kind + istante). */
export function overlayId(prefix: string, startMs: number, index: number): string {
  return `${prefix}-${startMs}-${index}`;
}

/** Ricerca di B-roll da risolvere (cartella o Pixabay) prima di aggiungerlo. */
export interface BrollRequest {
  startMs: number;
  endMs: number;
  query: string;
}

/**
 * Applica la parte testuale della proposta: schede al posto di quelle di prima (l'AI le rifà
 * tutte) e le ricerche di B-roll da risolvere. Il B-roll trovato si aggiunge con `withBroll`.
 */
export function enrichOverlays(
  segments: readonly ShortSegment[],
  plan: EnrichPlan,
): { overlays: Overlay[]; brollRequests: BrollRequest[] } {
  const overlays: Overlay[] = plan.overlays.flatMap((item, index) => {
    const segment = segments[item.segment];
    if (!segment) return [];
    const range = overlayRange(item.kind, segment);
    return [
      {
        id: overlayId(item.kind, range.startMs, index),
        kind: item.kind,
        title: item.title,
        body: item.kind === 'list' ? item.body : item.kind === 'code' ? item.body : '',
        code: item.kind === 'code' ? limitCode(item.code) : '',
        ...range,
      },
    ];
  });
  const brollRequests = plan.broll.flatMap((item) => {
    const segment = segments[item.segment];
    return segment ? [{ ...brollRange(segment), query: item.query }] : [];
  });
  return { overlays: overlays.slice(0, OVERLAY_LIMITS.max), brollRequests };
}

// --- Ricerca nell'archivio (Pixabay) -----------------------------------------------------------

export const StockSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  kind: z.enum(['video', 'image']).default('video'),
  /** Formato del video: verticale (9:16), orizzontale (16:9) o quadrato. */
  orientation: z.enum(['vertical', 'horizontal', 'square']).default('vertical'),
  /** Lingua delle parole cercate: le ricerche dell'AI sono in inglese, quelle scritte a mano in italiano. */
  lang: z.enum(['en', 'it']).default('en'),
});
export type StockSearchQuery = z.input<typeof StockSearchQuerySchema>;

export const StockItemSchema = z.object({
  id: z.int().positive(),
  kind: z.enum(['video', 'image']),
  pageUrl: z.string(),
  user: z.string(),
  tags: z.string(),
  previewUrl: z.string(),
  downloadUrl: z.string(),
  width: z.int().nonnegative(),
  height: z.int().nonnegative(),
  durationMs: z.int().nonnegative(),
});
export type StockItem = z.infer<typeof StockItemSchema>;

export const StockSearchResultSchema = z.object({
  source: z.literal('pixabay'),
  items: z.array(StockItemSchema),
});
export type StockSearchResult = z.infer<typeof StockSearchResultSchema>;

export const StockStatusSchema = z.object({ configured: z.boolean() });
export type StockStatus = z.infer<typeof StockStatusSchema>;

export const StockKeyInputSchema = z.object({ apiKey: z.string().trim().min(10).max(200) });

/**
 * Il risultato migliore per un intervallo: video lungo abbastanza e con l'orientamento del
 * formato (verticale per 9:16), poi il più grande; senza video adatti, null.
 */
export function bestStockItem(
  items: readonly StockItem[],
  needMs: number,
  orientation: 'vertical' | 'horizontal' | 'square',
): StockItem | null {
  const fits = (item: StockItem) =>
    orientation === 'vertical'
      ? item.height > item.width
      : orientation === 'horizontal'
        ? item.width > item.height
        : Math.abs(item.width - item.height) < item.width * 0.2;
  const longEnough = (item: StockItem) => item.kind === 'image' || item.durationMs >= needMs;
  const ranked = [...items].sort((a, b) => {
    const score = (item: StockItem) => (fits(item) ? 2 : 0) + (longEnough(item) ? 1 : 0);
    return score(b) - score(a) || b.width * b.height - a.width * a.height;
  });
  const best = ranked[0];
  return best && longEnough(best) ? best : null;
}

/** Parole della ricerca trovate nel nome del file (per la cartella dell'utente): 0 = nessuna. */
export function filenameScore(fileName: string, query: string): number {
  const words = (text: string) =>
    text
      .toLocaleLowerCase('it')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
  const name = new Set(words(fileName.replace(/\.[^.]+$/, '')));
  return words(query).filter((w) => name.has(w) || [...name].some((n) => n.startsWith(w))).length;
}
