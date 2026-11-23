import { z } from 'zod';
import type { Platform, VariantFormat } from '../domain/platforms.js';
import { IdSchema } from './common.js';
import { ContentSchema } from './content.js';
import { transcriptSegments, type TranscriptWord } from './transcript.js';
import { addCut, type TimeRange, type VideoEdit } from './video-edit.js';

/**
 * «Genera Short da video lungo» (fase 3e): l'LLM sceglie dalla trascrizione i momenti che
 * reggono da soli e scrive i testi; ogni momento diventa un contenuto in bozza nello Studio e,
 * sul desktop, un progetto video già tagliato in 9:16.
 */

/** Piattaforme dei video verticali brevi e formato della variant su ciascuna. */
export const SHORT_PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
] as const satisfies readonly Platform[];
export type ShortPlatform = (typeof SHORT_PLATFORMS)[number];

export const SHORT_VARIANT_FORMAT: Record<ShortPlatform, VariantFormat> = {
  youtube: 'short',
  tiktok: 'video',
  instagram: 'reel',
};

/**
 * Durata di un momento. Prudente rispetto ai limiti delle piattaforme (Short e Reel arrivano a
 * 3 minuti): da riverificare con gli adapter del 3f.
 */
export const SHORT_LIMITS = {
  minMs: 10_000,
  maxMs: 90_000,
  maxCount: 3,
  /** Frasi inviate al modello: oltre, il video è troppo lungo per una sola richiesta. */
  maxSegments: 1500,
  segmentTextMax: 2000,
} as const;

export const ShortSegmentSchema = z
  .object({
    startMs: z.int().nonnegative(),
    endMs: z.int().nonnegative(),
    text: z.string().trim().min(1).max(SHORT_LIMITS.segmentTextMax),
  })
  .refine((s) => s.endMs > s.startMs, { message: 'Fine prima dell’inizio' });
export type ShortSegment = z.infer<typeof ShortSegmentSchema>;

export const GenerateShortsRequestSchema = z.object({
  brandId: IdSchema,
  /** Titolo del progetto video, come contesto per il modello. */
  videoTitle: z.string().trim().min(1).max(200),
  durationMs: z.int().positive(),
  /** Frasi parlate in ordine, con i tempi del sorgente. */
  segments: z.array(ShortSegmentSchema).min(1).max(SHORT_LIMITS.maxSegments),
  platforms: z.array(z.enum(SHORT_PLATFORMS)).min(1).max(SHORT_PLATFORMS.length),
  count: z.int().min(1).max(SHORT_LIMITS.maxCount).default(SHORT_LIMITS.maxCount),
});
export type GenerateShortsRequest = z.input<typeof GenerateShortsRequestSchema>;

export const GeneratedShortSchema = z.object({
  content: ContentSchema,
  startMs: z.int().nonnegative(),
  endMs: z.int().positive(),
  /** Perché il modello ha scelto questo momento (da mostrare all'autore). */
  reason: z.string(),
});
export type GeneratedShort = z.infer<typeof GeneratedShortSchema>;

export const GenerateShortsResultSchema = z.object({ shorts: z.array(GeneratedShortSchema) });
export type GenerateShortsResult = z.infer<typeof GenerateShortsResultSchema>;

/** Frasi parlate della trascrizione, nel formato della richiesta (i silenzi non servono). */
export function shortSegments(
  words: readonly TranscriptWord[],
  durationMs: number,
): ShortSegment[] {
  return transcriptSegments(words, durationMs).flatMap((segment) =>
    segment.kind === 'speech'
      ? [
          {
            startMs: segment.startMs,
            endMs: Math.max(segment.endMs, segment.startMs + 1),
            text: segment.text.slice(0, SHORT_LIMITS.segmentTextMax),
          },
        ]
      : [],
  );
}

/**
 * Modifiche del progetto Short: tutto ciò che sta fuori dal momento è tagliato, i tagli del
 * video lungo dentro il momento restano, formato verticale e stesso stile dei sottotitoli.
 */
export function shortEdit(parent: VideoEdit, durationMs: number, moment: TimeRange): VideoEdit {
  let cuts = parent.cuts.filter((c) => c.endMs > moment.startMs && c.startMs < moment.endMs);
  if (moment.startMs > 0) cuts = addCut(cuts, { startMs: 0, endMs: moment.startMs });
  if (moment.endMs < durationMs) cuts = addCut(cuts, { startMs: moment.endMs, endMs: durationMs });
  return {
    ...parent,
    cuts,
    format: '9:16',
    cropOffset: parent.format === '9:16' ? parent.cropOffset : 0.5,
  };
}
