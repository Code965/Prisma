import { z } from 'zod';
import { VariantFormatSchema } from '../domain/platforms.js';
import { InstantSchema } from './common.js';
import { METRIC_SOURCES } from './metrics.js';

/**
 * Concorrenti (fase 8b). YouTube si legge dalla YouTube Data API (canali e video pubblici);
 * LinkedIn, Instagram e TikTok non danno i post altrui con le API in uso, quindi si inseriscono a
 * mano. Tutti i numeri sono quelli letti o inseriti: quelli che mancano restano null, mai zero.
 */

export const COMPETITOR_PLATFORMS = ['linkedin', 'instagram', 'tiktok', 'youtube'] as const;
export const CompetitorPlatformSchema = z.enum(COMPETITOR_PLATFORMS);
export type CompetitorPlatform = (typeof COMPETITOR_PLATFORMS)[number];

/** Concorrenti per brand al massimo. */
export const COMPETITOR_MAX = 10;
/** Post letti per canale YouTube a ogni aggiornamento (una pagina di playlistItems.list). */
export const COMPETITOR_YOUTUBE_POSTS = 50;
/** Finestra delle statistiche. */
export const COMPETITOR_WINDOW_DAYS = 90;
/** «Aggiorna» su un canale non prima di questo intervallo dal precedente. */
export const COMPETITOR_REFRESH_COOLDOWN_MS = 15 * 60_000;

const HttpUrlSchema = z.url({ protocol: /^https?$/, error: 'Indirizzo http o https' }).max(500);

export const CompetitorInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: CompetitorPlatformSchema,
  /** YouTube: handle (@nome) o id del canale (UC…); le altre: nome del profilo. */
  handle: z.string().trim().min(1).max(120),
  url: HttpUrlSchema.nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type CompetitorInput = z.infer<typeof CompetitorInputSchema>;

const count = z.int().nonnegative().max(2_000_000_000);

export const CompetitorPostInputSchema = z
  .object({
    title: z.string().trim().max(200).nullish(),
    text: z.string().trim().max(3000).nullish(),
    url: HttpUrlSchema,
    publishedAt: InstantSchema,
    format: VariantFormatSchema,
    likes: count.nullish(),
    comments: count.nullish(),
    shares: count.nullish(),
    views: count.nullish(),
    /** Follower del profilo quando è stato letto il post. */
    followers: count.nullish(),
  })
  .refine((value) => Boolean(value.title || value.text), {
    message: 'Scrivi il titolo o il testo del post',
    path: ['text'],
  });
export type CompetitorPostInput = z.infer<typeof CompetitorPostInputSchema>;

export const CompetitorPostSchema = z.object({
  id: z.int().positive(),
  competitorId: z.int().positive(),
  externalId: z.string().nullable(),
  title: z.string().nullable(),
  text: z.string().nullable(),
  url: z.string(),
  publishedAt: InstantSchema,
  format: VariantFormatSchema,
  /** Durata in secondi (video YouTube). */
  durationSec: z.int().nonnegative().nullable(),
  likes: count.nullable(),
  comments: count.nullable(),
  shares: count.nullable(),
  views: count.nullable(),
  followers: count.nullable(),
  source: z.enum(METRIC_SOURCES),
});
export type CompetitorPost = z.infer<typeof CompetitorPostSchema>;

/** Su cosa si calcola il tasso di interazione: visualizzazioni del post o follower del profilo. */
export const ENGAGEMENT_BASES = ['visualizzazioni', 'follower'] as const;
export type EngagementBasis = (typeof ENGAGEMENT_BASES)[number];

export const RankedPostSchema = z.object({
  postId: z.int().positive().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  publishedAt: InstantSchema,
  format: VariantFormatSchema,
  interactions: z.int().nonnegative(),
  /** Interazioni / base (0–1); null senza base. */
  rate: z.number().nonnegative().nullable(),
});
export type RankedPost = z.infer<typeof RankedPostSchema>;

/** Statistiche di un profilo (concorrente o il brand stesso) nella finestra di 90 giorni. */
export const ProfileStatsSchema = z.object({
  posts: z.int().nonnegative(),
  /** Settimane coperte dai dati (dal post più vecchio letto, al massimo 90 giorni). */
  weeks: z.number().nonnegative(),
  postsPerWeek: z.number().nonnegative().nullable(),
  basis: z.enum(ENGAGEMENT_BASES).nullable(),
  /** Mediana del tasso di interazione dei post (interazioni / base). */
  medianRate: z.number().nonnegative().nullable(),
  medianInteractions: z.number().nonnegative().nullable(),
  followers: count.nullable(),
  formats: z.array(
    z.object({
      format: VariantFormatSchema,
      posts: z.int().positive(),
      medianRate: z.number().nonnegative().nullable(),
      medianInteractions: z.number().nonnegative(),
    }),
  ),
  /** Fasce migliori (giorno 0 = lunedì, ora italiana) con almeno 2 post. */
  slots: z.array(
    z.object({
      weekday: z.int().min(0).max(6),
      hour: z.int().min(0).max(23),
      posts: z.int().positive(),
      score: z.number().nonnegative(),
    }),
  ),
  top: z.array(RankedPostSchema),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

export const CompetitorSchema = z.object({
  id: z.int().positive(),
  brandId: z.int().positive(),
  name: z.string(),
  platform: CompetitorPlatformSchema,
  handle: z.string(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  /** Id del canale YouTube. */
  externalId: z.string().nullable(),
  /** Ultimo numero di follower noto (iscritti di YouTube, arrotondati da YouTube). */
  followers: count.nullable(),
  lastFetchedAt: InstantSchema.nullable(),
  lastError: z.string().nullable(),
  createdAt: InstantSchema,
  posts: z.array(CompetitorPostSchema),
  stats: ProfileStatsSchema,
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CompetitorAnalysisSchema = z.object({
  createdAt: InstantSchema,
  model: z.string(),
  basedOn: z.int().nonnegative(),
  summary: z.string(),
  hooks: z.array(z.object({ pattern: z.string(), postIds: z.array(z.int().positive()) })),
  structure: z.string(),
  length: z.string(),
  topics: z.array(z.object({ topic: z.string(), postIds: z.array(z.int().positive()) })),
  repeat: z.array(z.string()),
  avoid: z.array(z.string()),
});
export type CompetitorAnalysis = z.infer<typeof CompetitorAnalysisSchema>;

export const CompetitorsStateSchema = z.object({
  competitors: z.array(CompetitorSchema),
  /** Le stesse statistiche sui post pubblicati dal brand, per piattaforma (dove ci sono dati). */
  own: z.array(z.object({ platform: CompetitorPlatformSchema, stats: ProfileStatsSchema })),
  analysis: CompetitorAnalysisSchema.nullable(),
  /** Perché l'analisi dell'AI non si può fare; null se si può. */
  analysisBlocked: z.string().nullable(),
});
export type CompetitorsState = z.infer<typeof CompetitorsStateSchema>;
