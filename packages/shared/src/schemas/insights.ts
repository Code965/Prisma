import { z } from 'zod';
import { InstantSchema } from './common.js';

/**
 * Suggerimenti settimanali dell'AI (fase 4d): uno per tipo, come nel mockup. Si basano solo
 * sulle metriche raccolte; con pochi dati non si generano.
 */

export const INSIGHT_KINDS = ['argomenti', 'orari', 'formati'] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_KIND_LABELS: Record<InsightKind, string> = {
  argomenti: 'ARGOMENTI CHE FUNZIONANO',
  orari: 'ORARI MIGLIORI',
  formati: 'FORMATI DA REPLICARE',
};

export const InsightTipSchema = z.object({
  kind: z.enum(INSIGHT_KINDS),
  text: z.string().min(1).max(400),
  /** Su quali dati si basa (mostrato sotto il suggerimento). */
  why: z.string().min(1).max(300),
  /** Per gli argomenti: il testo di un'idea da aggiungere con un clic. */
  idea: z.string().max(500).nullable(),
});
export type InsightTip = z.infer<typeof InsightTipSchema>;

export const AnalyticsInsightsSchema = z.object({
  id: z.int().positive(),
  createdAt: InstantSchema,
  /** Lunedì (ora italiana) della settimana per cui sono stati generati. */
  weekStart: z.string(),
  model: z.string(),
  /** Post con metriche usati. */
  basedOn: z.int().nonnegative(),
  tips: z.array(InsightTipSchema),
});
export type AnalyticsInsights = z.infer<typeof AnalyticsInsightsSchema>;

export const InsightsStateSchema = z.object({
  insights: AnalyticsInsightsSchema.nullable(),
  /** Perché non si possono generare (pochi dati, LLM non configurato); null se si può. */
  blocked: z.string().nullable(),
});
export type InsightsState = z.infer<typeof InsightsStateSchema>;

/** Post con metriche negli ultimi 56 giorni sotto cui i suggerimenti non hanno senso. */
export const INSIGHTS_MIN_POSTS = 3;
