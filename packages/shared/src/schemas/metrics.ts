import { z } from 'zod';
import { InstantSchema } from './common.js';

/**
 * Metriche (fase 4). Ogni piattaforma espone dati diversi: quelli che mancano restano null
 * invece di diventare zero (TikTok non ha la copertura, LinkedIn si inserisce a mano).
 */

export const METRIC_SOURCES = ['api', 'manuale'] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

const count = z.int().nonnegative().nullable();

/** Ultima fotografia delle metriche di una pubblicazione. */
export const PublicationMetricsSchema = z.object({
  publicationId: z.int().positive(),
  capturedAt: InstantSchema,
  impressions: count,
  reach: count,
  views: count,
  likes: count,
  comments: count,
  shares: count,
  saves: count,
  source: z.enum(METRIC_SOURCES),
});
export type PublicationMetrics = z.infer<typeof PublicationMetricsSchema>;

const manualCount = z.int().nonnegative().max(1_000_000_000).nullable().optional();

/**
 * Metriche inserite a mano (LinkedIn non le espone alle app self-serve): almeno un valore.
 * Su LinkedIn «reazioni» → `likes`, «diffusioni» → `shares`.
 */
export const ManualMetricsInputSchema = z
  .object({
    impressions: manualCount,
    reach: manualCount,
    likes: manualCount,
    comments: manualCount,
    shares: manualCount,
    saves: manualCount,
  })
  .refine((m) => Object.values(m).some((v) => v !== null && v !== undefined), {
    message: 'Inserisci almeno un valore',
  });
export type ManualMetricsInput = z.infer<typeof ManualMetricsInputSchema>;

/** Interazioni di un post: somma dei valori presenti (null se non ce n'è nessuno). */
export function interactionsOf(
  metrics: Pick<PublicationMetrics, 'likes' | 'comments' | 'shares' | 'saves'>,
): number | null {
  const values = [metrics.likes, metrics.comments, metrics.shares, metrics.saves].filter(
    (v): v is number => v !== null,
  );
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}
