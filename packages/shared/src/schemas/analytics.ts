import { z } from 'zod';
import { PlatformSchema, VariantFormatSchema } from '../domain/platforms.js';
import { InstantSchema } from './common.js';
import { PublicationMetricsSchema } from './metrics.js';

/** Periodi della schermata Analytics: 8 settimane e 90 giorni a settimane, 30 giorni a giorni. */
export const ANALYTICS_PERIODS = ['8w', '30d', '90d'] as const;
export const AnalyticsPeriodSchema = z.enum(ANALYTICS_PERIODS);
export type AnalyticsPeriod = z.infer<typeof AnalyticsPeriodSchema>;

export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  '8w': 'Ultime 8 settimane',
  '30d': 'Ultimi 30 giorni',
  '90d': 'Ultimi 90 giorni',
};

/** Metriche dei grafici, come nel mockup. */
export const ANALYTICS_METRICS = ['reach', 'followers', 'interactions'] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

export const ANALYTICS_METRIC_LABELS: Record<AnalyticsMetric, string> = {
  reach: 'Copertura',
  followers: 'Nuovi follower',
  interactions: 'Interazioni',
};

/** Piattaforme dei grafici, nell'ordine del mockup (il blog non ha metriche). */
export const ANALYTICS_PLATFORMS = ['linkedin', 'instagram', 'tiktok', 'youtube'] as const;

const series = z.array(z.number().nullable());

export const AnalyticsBucketSchema = z.object({
  /** Primo giorno (YYYY-MM-DD, ora italiana) e giorno dopo l'ultimo. */
  start: z.string(),
  end: z.string(),
  label: z.string(),
});
export type AnalyticsBucket = z.infer<typeof AnalyticsBucketSchema>;

export const PlatformSeriesSchema = z.object({
  platform: PlatformSchema,
  series: z.object({ reach: series, followers: series, interactions: series }),
  /** Cosa c'è davvero dietro una metrica, quando non è quella del titolo (es. visualizzazioni). */
  notes: z.object({
    reach: z.string().nullable(),
    followers: z.string().nullable(),
    interactions: z.string().nullable(),
  }),
});
export type PlatformSeries = z.infer<typeof PlatformSeriesSchema>;

export const TopContentSchema = z.object({
  publicationId: z.int().positive(),
  contentId: z.int().positive(),
  title: z.string(),
  platform: PlatformSchema,
  format: VariantFormatSchema,
  publishedAt: InstantSchema,
  externalUrl: z.string().nullable(),
  /** Copertura, o visualizzazioni/impressioni dove la piattaforma non ha la copertura. */
  reach: z.number().nullable(),
  reachKind: z.enum(['copertura', 'visualizzazioni', 'impressioni']).nullable(),
  interactions: z.number().nullable(),
});
export type TopContent = z.infer<typeof TopContentSchema>;

/** Post LinkedIn del periodo, per inserire le metriche a mano. */
export const ManualMetricsRowSchema = z.object({
  publicationId: z.int().positive(),
  title: z.string(),
  publishedAt: InstantSchema,
  externalUrl: z.string().nullable(),
  metrics: PublicationMetricsSchema.nullable(),
});
export type ManualMetricsRow = z.infer<typeof ManualMetricsRowSchema>;

export const AnalyticsReportSchema = z.object({
  period: AnalyticsPeriodSchema,
  buckets: z.array(AnalyticsBucketSchema),
  platforms: z.array(PlatformSeriesSchema),
  top: z.array(TopContentSchema),
  manual: z.array(ManualMetricsRowSchema),
  generatedAt: InstantSchema,
});
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;
