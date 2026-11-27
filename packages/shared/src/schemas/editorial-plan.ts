import { z } from 'zod';
import { SlotSchema } from '../domain/recommended-slots.js';
import { PlatformSchema, VariantFormatSchema } from '../domain/platforms.js';
import { IdSchema, InstantSchema } from './common.js';

/**
 * Piano editoriale mensile dell'AI (fase 8e): pilastri, frequenza per piattaforma, formati, orari
 * (dagli slot consigliati) e idee datate, nate da trend, concorrenti o dai propri post migliori.
 * Il piano propone e basta: «Metti nel calendario» crea solo idee, mai bozze approvate né
 * pubblicazioni. La revisione confronta il piano con ciò che è stato fatto.
 */

/** Mese nel formato `AAAA-MM`. */
export const PlanMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mese nel formato AAAA-MM');
export type PlanMonth = z.infer<typeof PlanMonthSchema>;

/** Giorno di calendario italiano `AAAA-MM-GG`. */
export const PlanDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Giorno nel formato AAAA-MM-GG');

export const PLAN_PILLARS_MIN = 3;
export const PLAN_PILLARS_MAX = 5;
export const PLAN_ITEMS_MAX = 40;
/** Mesi futuri che si possono pianificare oltre a quello in corso. */
export const PLAN_MONTHS_AHEAD = 2;

/** Da dove nasce un'idea del piano. */
export const PLAN_SOURCES = ['trend', 'concorrente', 'tuo_post', 'pilastro'] as const;
export const PlanSourceSchema = z.enum(PLAN_SOURCES);
export type PlanSource = (typeof PLAN_SOURCES)[number];

export const PLAN_SOURCE_LABELS: Record<PlanSource, string> = {
  trend: 'Trend',
  concorrente: 'Concorrente',
  tuo_post: 'Tuo post migliore',
  pilastro: 'Pilastro',
};

export const PlanPillarSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Tag del brand a cui il pilastro è legato; null se nessuno è adatto. */
  tagId: IdSchema.nullable(),
});
export type PlanPillar = z.infer<typeof PlanPillarSchema>;

export const PlanFrequencySchema = z.object({
  platform: PlatformSchema,
  perWeek: z.int().min(1).max(7),
  formats: z.array(VariantFormatSchema),
  /** Orari scelti tra gli slot consigliati della piattaforma. */
  slots: z.array(SlotSchema),
  note: z.string(),
});
export type PlanFrequency = z.infer<typeof PlanFrequencySchema>;

/** Il riferimento da cui nasce un'idea (trend, post di un concorrente, proprio post). */
export const PlanReferenceSchema = z.object({
  label: z.string(),
  url: z.string().nullable(),
});
export type PlanReference = z.infer<typeof PlanReferenceSchema>;

export const PlanItemSchema = z.object({
  /** Stabile dentro il piano (`i0`, `i1`…). */
  id: z.string(),
  day: PlanDaySchema,
  /** Ora dello slot consigliato in quel giorno della settimana, se c'è. */
  hour: z.int().min(0).max(23).nullable(),
  platform: PlatformSchema,
  format: VariantFormatSchema,
  /** Nome del pilastro (resta leggibile anche se il piano viene rigenerato). */
  pillar: z.string(),
  text: z.string(),
  source: PlanSourceSchema,
  reference: PlanReferenceSchema.nullable(),
  /** Idea creata da «Metti nel calendario» o «Crea l'idea». */
  ideaId: IdSchema.nullable(),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const PlanReviewCommentSchema = z.object({
  text: z.string(),
  model: z.string(),
  createdAt: InstantSchema,
});
export type PlanReviewComment = z.infer<typeof PlanReviewCommentSchema>;

export const EditorialPlanSchema = z.object({
  id: IdSchema,
  month: PlanMonthSchema,
  model: z.string(),
  createdAt: InstantSchema,
  summary: z.string(),
  pillars: z.array(PlanPillarSchema),
  frequencies: z.array(PlanFrequencySchema),
  items: z.array(PlanItemSchema),
  reviewComment: PlanReviewCommentSchema.nullable(),
});
export type EditorialPlan = z.infer<typeof EditorialPlanSchema>;

// --- Revisione: piano contro fatto ----------------------------------------------------------

/** A che punto è un'idea del piano. */
export const PLAN_ITEM_PROGRESS = [
  'da_creare',
  'idea',
  'bozza',
  'programmato',
  'pubblicato',
] as const;
export const PlanItemProgressSchema = z.enum(PLAN_ITEM_PROGRESS);
export type PlanItemProgress = (typeof PLAN_ITEM_PROGRESS)[number];

export const PLAN_ITEM_PROGRESS_LABELS: Record<PlanItemProgress, string> = {
  da_creare: 'Da creare',
  idea: 'Idea creata',
  bozza: 'In lavorazione',
  programmato: 'Programmato',
  pubblicato: 'Pubblicato',
};

const count = z.int().nonnegative();

export const PlanItemReviewSchema = z.object({
  itemId: z.string(),
  progress: PlanItemProgressSchema,
  /** Giorno passato senza un'uscita programmata o pubblicata. */
  late: z.boolean(),
  /** Pubblicazione del contenuto nato dall'idea sulla piattaforma del piano, se c'è. */
  publicationId: IdSchema.nullable(),
  url: z.string().nullable(),
  /** Interazioni note (like + commenti + condivisioni + salvataggi), null se non misurate. */
  interactions: count.nullable(),
});
export type PlanItemReview = z.infer<typeof PlanItemReviewSchema>;

export const PlanPlatformReviewSchema = z.object({
  platform: PlatformSchema,
  /** Uscite previste dal piano e dalla frequenza (settimane × volte a settimana). */
  planned: count,
  target: count,
  /** Uscite nel mese su quella piattaforma, dal piano o no. */
  published: count,
  scheduled: count,
  /** Mediana delle interazioni dei post pubblicati nel mese (null senza metriche). */
  medianInteractions: z.number().nullable(),
});
export type PlanPlatformReview = z.infer<typeof PlanPlatformReviewSchema>;

export const PlanReviewSchema = z.object({
  /** Giorno fino a cui si confronta (oggi o l'ultimo del mese). */
  until: PlanDaySchema,
  /** Quota del mese già trascorsa, 0–1. */
  elapsed: z.number().min(0).max(1),
  totals: z.object({
    items: count,
    ideas: count,
    drafts: count,
    scheduled: count,
    published: count,
    late: count,
  }),
  items: z.array(PlanItemReviewSchema),
  platforms: z.array(PlanPlatformReviewSchema),
  /** Pubblicazioni del mese che non vengono da un'idea del piano. */
  outsidePlan: count,
});
export type PlanReview = z.infer<typeof PlanReviewSchema>;

export const PlanStateSchema = z.object({
  month: PlanMonthSchema,
  plan: EditorialPlanSchema.nullable(),
  /** Null finché il mese non è iniziato o senza piano. */
  review: PlanReviewSchema.nullable(),
  /** Perché non si può generare (AI non configurata, mese passato…); null se si può. */
  blocked: z.string().nullable(),
  /** Uscite già programmate o pubblicate nel mese (il piano non ci si sovrappone). */
  booked: z.array(z.object({ day: PlanDaySchema, platform: PlatformSchema, title: z.string() })),
});
export type PlanState = z.infer<typeof PlanStateSchema>;

export const PlanGenerateInputSchema = z.object({
  /** Piattaforme da pianificare; vuoto = quelle con un account collegato (o i quattro social). */
  platforms: z
    .array(PlatformSchema)
    .refine((list) => new Set(list).size === list.length, 'Piattaforme duplicate')
    .default([]),
});
export type PlanGenerateInput = z.infer<typeof PlanGenerateInputSchema>;

export const PlanIdeasInputSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(PLAN_ITEMS_MAX),
  /** true = «Metti nel calendario» (l'idea ricorda il giorno), false = «Crea l'idea». */
  withDay: z.boolean().default(true),
});
export type PlanIdeasInput = z.infer<typeof PlanIdeasInputSchema>;
