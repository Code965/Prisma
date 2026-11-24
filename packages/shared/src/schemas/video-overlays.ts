import { z } from 'zod';

/**
 * Testi in sovrimpressione e B-roll (fase 6d). I tempi sono del sorgente, come tagli e zoom:
 * il render li porta sul video montato. Le schede sono disegnate con il brand kit (come le slide
 * dei caroselli); il B-roll copre tutto il riquadro mentre la voce continua.
 */

export const OVERLAY_KINDS = ['title', 'code', 'list'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export const OVERLAY_KIND_LABELS: Record<OverlayKind, string> = {
  title: 'Titolo',
  code: 'Codice',
  list: 'Elenco',
};

export const OVERLAY_LIMITS = {
  titleMax: 80,
  bodyMax: 300,
  codeMax: 600,
  codeLinesMax: 8,
  listItemsMax: 4,
  minMs: 1500,
  maxMs: 10_000,
  /** Il titolo resta in vista al massimo così a lungo, anche se la frase è più lunga. */
  titleMs: 3500,
  max: 40,
} as const;

export const BROLL_LIMITS = {
  minMs: 1500,
  maxMs: 8000,
  max: 40,
} as const;

const OverlayBaseSchema = z.object({
  id: z.string().min(1).max(40),
  startMs: z.int().nonnegative(),
  endMs: z.int().positive(),
});

export const OverlaySchema = OverlayBaseSchema.extend({
  kind: z.enum(OVERLAY_KINDS),
  title: z.string().trim().max(OVERLAY_LIMITS.titleMax),
  /** Negli elenchi: una riga per punto. */
  body: z.string().max(OVERLAY_LIMITS.bodyMax).default(''),
  code: z.string().max(OVERLAY_LIMITS.codeMax).default(''),
}).refine((o) => o.endMs > o.startMs, 'Intervallo vuoto');
export type Overlay = z.infer<typeof OverlaySchema>;

export const BROLL_SOURCES = ['cartella', 'pixabay'] as const;
export type BrollSource = (typeof BROLL_SOURCES)[number];

/** Un file di B-roll sul computer: dalla cartella dell'utente o scaricato da Pixabay. */
export const BrollMediaSchema = z.object({
  /** `cartella/<nome>` o `pixabay/<file>`: il main sa dove sta e serve solo quelli. */
  key: z.string().min(1).max(300),
  path: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(260),
  kind: z.enum(['video', 'image']),
  width: z.int().positive(),
  height: z.int().positive(),
  /** 0 per le immagini. */
  durationMs: z.int().nonnegative(),
  source: z.enum(BROLL_SOURCES),
  /** «Video di Coverr-Free-Footage da Pixabay»; null per i file propri. */
  credit: z.string().max(300).nullable(),
  pageUrl: z.string().max(500).nullable(),
});
export type BrollMedia = z.infer<typeof BrollMediaSchema>;

export const BrollSchema = OverlayBaseSchema.extend({
  media: BrollMediaSchema,
  /** Parola o frase cercata (per sostituirlo con un altro risultato). */
  query: z.string().max(100).default(''),
}).refine((b) => b.endMs > b.startMs, 'Intervallo vuoto');
export type Broll = z.infer<typeof BrollSchema>;

/** Al massimo 8 righe di codice, come nelle slide. */
export function limitCode(code: string): string {
  return code.split('\n').slice(0, OVERLAY_LIMITS.codeLinesMax).join('\n').trimEnd();
}

/** Scheda in vista in un istante del sorgente (l'ultima se si sovrappongono). */
export function overlayAt(overlays: readonly Overlay[], sourceMs: number): Overlay | null {
  return [...overlays].reverse().find((o) => o.startMs <= sourceMs && sourceMs < o.endMs) ?? null;
}

export function brollAt(broll: readonly Broll[], sourceMs: number): Broll | null {
  return [...broll].reverse().find((b) => b.startMs <= sourceMs && sourceMs < b.endMs) ?? null;
}
