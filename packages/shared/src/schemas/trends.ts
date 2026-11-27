import { z } from 'zod';
import { InstantSchema } from './common.js';

/**
 * Radar dei trend (fase 8a): contenuti recenti e popolari da fonti pubbliche, cercati con le
 * parole del radar del brand, raggruppati e valutati dall'AI. I segnali (punti, stelle, reazioni,
 * visualizzazioni) sono quelli restituiti dalle fonti, mai stimati.
 */

export const TREND_SOURCES = ['hackernews', 'github', 'devto', 'youtube'] as const;
export const TrendSourceSchema = z.enum(TREND_SOURCES);
export type TrendSource = (typeof TREND_SOURCES)[number];

export const TREND_SOURCE_LABELS: Record<TrendSource, string> = {
  hackernews: 'Hacker News',
  github: 'GitHub',
  devto: 'dev.to',
  youtube: 'YouTube',
};

/** Parole del radar: al massimo 5 (una ricerca per fonte e parola). */
export const TREND_MAX_KEYWORDS = 5;
/** Un nuovo aggiornamento a mano non prima di questo intervallo dal precedente. */
export const TREND_REFRESH_COOLDOWN_MS = 15 * 60_000;
/** Ricerche di YouTube nelle ultime 24 ore (search.list ha un limite di 100 al giorno per progetto). */
export const TREND_YOUTUBE_DAILY_SEARCHES = 3;

export const TrendKeywordSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N} .+#-]+$/u, 'Usa lettere, numeri, spazi e . + # -');

export const TrendSettingsInputSchema = z.object({
  keywords: z
    .array(TrendKeywordSchema)
    .max(TREND_MAX_KEYWORDS)
    .refine(
      (list) => new Set(list.map((k) => k.toLowerCase())).size === list.length,
      'Parole ripetute',
    ),
});
export type TrendSettingsInput = z.infer<typeof TrendSettingsInputSchema>;

/** Segnali numerici della fonte: assenti = la fonte non li dà. */
export const TrendSignalsSchema = z.object({
  points: z.int().nonnegative().optional(),
  comments: z.int().nonnegative().optional(),
  stars: z.int().nonnegative().optional(),
  reactions: z.int().nonnegative().optional(),
  views: z.int().nonnegative().optional(),
  likes: z.int().nonnegative().optional(),
});
export type TrendSignals = z.infer<typeof TrendSignalsSchema>;

export const TrendItemSchema = z.object({
  /** `<fonte>:<id della fonte>`. */
  id: z.string(),
  source: TrendSourceSchema,
  title: z.string(),
  url: z.string(),
  author: z.string().nullable(),
  description: z.string().nullable(),
  publishedAt: InstantSchema,
  /** Parola del radar con cui è stato trovato. */
  keyword: z.string(),
  signals: TrendSignalsSchema,
});
export type TrendItem = z.infer<typeof TrendItemSchema>;

/** Valutazioni dell'AI da 1 a 5 (giudizi, non misure). */
export const TrendScoresSchema = z.object({
  growth: z.int().min(1).max(5),
  interest: z.int().min(1).max(5),
  fit: z.int().min(1).max(5),
});
export type TrendScores = z.infer<typeof TrendScoresSchema>;

export const TrendSchema = z.object({
  title: z.string(),
  summary: z.string(),
  why: z.string(),
  scores: TrendScoresSchema,
  /** Argomento (tag) del brand proposto per l'idea; null se nessuno è adatto. */
  tagId: z.int().positive().nullable(),
  idea: z.string(),
  itemIds: z.array(z.string()).min(1),
});
export type Trend = z.infer<typeof TrendSchema>;

export const TrendSourceStatusSchema = z.object({
  source: TrendSourceSchema,
  items: z.int().nonnegative(),
  /** Ricerche fatte (per la quota di YouTube: al massimo 3 al giorno). */
  requests: z.int().nonnegative(),
  /** Perché la fonte non ha dato risultati (errore, account non collegato…); null se è andata. */
  error: z.string().nullable(),
});
export type TrendSourceStatus = z.infer<typeof TrendSourceStatusSchema>;

export const TrendReportSchema = z.object({
  id: z.int().positive(),
  createdAt: InstantSchema,
  model: z.string(),
  keywords: z.array(z.string()),
  sources: z.array(TrendSourceStatusSchema),
  items: z.array(TrendItemSchema),
  trends: z.array(TrendSchema),
});
export type TrendReport = z.infer<typeof TrendReportSchema>;

export const TrendsStateSchema = z.object({
  keywords: z.array(z.string()),
  report: TrendReportSchema.nullable(),
  /** Perché non si può aggiornare (AI non configurata, nessuna parola); null se si può. */
  blocked: z.string().nullable(),
  /** Primo istante in cui «Aggiorna» è di nuovo ammesso; null se lo è già. */
  nextRefreshAt: InstantSchema.nullable(),
});
export type TrendsState = z.infer<typeof TrendsStateSchema>;
