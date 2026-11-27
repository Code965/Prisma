import { z } from 'zod';
import { VariantFormatSchema, type VariantFormat } from '../domain/platforms.js';
import { InstantSchema } from './common.js';
import { ENGAGEMENT_BASES } from './competitors.js';

/**
 * Analisi dei propri post (fase 8d): per piattaforma, negli ultimi 90 giorni, il tasso di
 * interazione dei post pubblicati confrontato per argomento, formato, apertura, lunghezza, giorno
 * e fascia oraria. Tutti i numeri vengono dalle metriche raccolte: mediane e conteggi, mai stime.
 * L'AI (facoltativa) classifica le aperture e trae qualche conclusione citando i post.
 */

export const POST_ANALYSIS_WINDOW_DAYS = 90;
/** Un gruppo con meno post è segnato «pochi dati». */
export const POST_ANALYSIS_MIN_GROUP = 2;
/** Post con metriche sotto cui l'analisi dell'AI non ha senso. */
export const POST_ANALYSIS_MIN_POSTS = 3;

export const POST_ANALYSIS_PLATFORMS = ['linkedin', 'instagram', 'tiktok', 'youtube'] as const;
export const PostAnalysisPlatformSchema = z.enum(POST_ANALYSIS_PLATFORMS);

export const POST_DIMENSIONS = [
  'argomento',
  'formato',
  'apertura',
  'lunghezza',
  'giorno',
  'fascia',
] as const;
export type PostDimension = (typeof POST_DIMENSIONS)[number];

export const POST_DIMENSION_LABELS: Record<PostDimension, string> = {
  argomento: 'Argomento',
  formato: 'Formato',
  apertura: 'Apertura',
  lunghezza: 'Lunghezza del testo',
  giorno: 'Giorno',
  fascia: 'Fascia oraria',
};

export const POST_FORMAT_LABELS: Record<VariantFormat, string> = {
  post: 'Post',
  carosello: 'Carosello',
  reel: 'Reel',
  storia: 'Storia',
  video: 'Video',
  short: 'Short',
  articolo: 'Articolo',
};

const count = z.int().nonnegative();

export const PostGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Post con interazioni note nel gruppo. */
  posts: count,
  medianRate: z.number().nullable(),
  medianInteractions: z.number().nullable(),
  /** Meno di `POST_ANALYSIS_MIN_GROUP` post: il confronto non dice molto. */
  fewData: z.boolean(),
  publicationIds: z.array(z.int().positive()),
});
export type PostGroup = z.infer<typeof PostGroupSchema>;

export const AnalyzedPostSchema = z.object({
  publicationId: z.int().positive(),
  title: z.string(),
  url: z.string().nullable(),
  publishedAt: InstantSchema,
  format: VariantFormatSchema,
  tags: z.array(z.string()),
  words: count,
  /** Prima frase del testo (o il titolo per YouTube). */
  opening: z.string(),
  openingKind: z.string(),
  interactions: count.nullable(),
  rate: z.number().nullable(),
});
export type AnalyzedPost = z.infer<typeof AnalyzedPostSchema>;

export const PlatformPostAnalysisSchema = z.object({
  platform: PostAnalysisPlatformSchema,
  /** Post pubblicati nella finestra e quelli con interazioni note. */
  published: count,
  measured: count,
  basis: z.enum(ENGAGEMENT_BASES).nullable(),
  medianRate: z.number().nullable(),
  medianInteractions: z.number().nullable(),
  dimensions: z.array(
    z.object({ dimension: z.enum(POST_DIMENSIONS), groups: z.array(PostGroupSchema) }),
  ),
  posts: z.array(AnalyzedPostSchema),
});
export type PlatformPostAnalysis = z.infer<typeof PlatformPostAnalysisSchema>;

export const PostAnalysisAiSchema = z.object({
  model: z.string(),
  createdAt: InstantSchema,
  basedOn: count,
  conclusions: z.array(z.object({ text: z.string(), publicationIds: z.array(z.int().positive()) })),
});
export type PostAnalysisAi = z.infer<typeof PostAnalysisAiSchema>;

export const PostAnalysisSchema = z.object({
  generatedAt: InstantSchema,
  windowDays: z.int().positive(),
  platforms: z.array(PlatformPostAnalysisSchema),
  /** Perché l'analisi dell'AI non si può chiedere (pochi dati, AI non configurata), o null. */
  aiBlocked: z.string().nullable(),
  /** Presente solo nella risposta di «Analizza con l'AI» (non si salva). */
  ai: PostAnalysisAiSchema.nullable(),
});
export type PostAnalysis = z.infer<typeof PostAnalysisSchema>;
