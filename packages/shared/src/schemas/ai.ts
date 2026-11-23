import { z } from 'zod';
import { IdSchema, InstantSchema } from './common.js';
import { CAROUSEL_LIMITS } from './carousel.js';
import { VariantSchema } from './variant.js';

/** Istruzione in linguaggio naturale per modificare una bozza ("accorcia l'inizio"). */
export const EditVariantRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(1000),
  expectedVersion: z.int().nonnegative(),
});
export type EditVariantRequest = z.infer<typeof EditVariantRequestSchema>;

export const ChatMessageSchema = z.object({
  id: IdSchema,
  contentId: IdSchema,
  variantId: IdSchema.nullable(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  revisionId: IdSchema.nullable(),
  createdAt: InstantSchema,
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Esito di una modifica via chat: il testo prima e dopo serve alla UI per mostrare il diff. */
export const EditVariantResultSchema = z.object({
  variant: VariantSchema,
  reply: z.string(),
  before: z.string(),
  after: z.string(),
  revisionId: IdSchema,
});
export type EditVariantResult = z.infer<typeof EditVariantResultSchema>;

/** Crea le slide dal testo della variant (sovrascrive quelle esistenti). */
export const GenerateCarouselRequestSchema = z.object({
  expectedVersion: z.int().nonnegative(),
});
export type GenerateCarouselRequest = z.infer<typeof GenerateCarouselRequestSchema>;

/** «Modifica la slide scrivendo»: l'istruzione riguarda la slide selezionata, nel contesto delle altre. */
export const EditCarouselRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(1000),
  expectedVersion: z.int().nonnegative(),
  slideIndex: z
    .int()
    .min(0)
    .max(CAROUSEL_LIMITS.maxSlides - 1),
});
export type EditCarouselRequest = z.infer<typeof EditCarouselRequestSchema>;

/**
 * Esito: o le slide modificate (variant salvata, torna bozza) o fino a tre proposte di titolo per
 * la slide, da scegliere nell'editor senza salvare nulla.
 */
export const EditCarouselResultSchema = z.object({
  reply: z.string(),
  variant: VariantSchema.nullable(),
  proposals: z.array(z.string()).max(3),
});
export type EditCarouselResult = z.infer<typeof EditCarouselResultSchema>;

export const RestoreRevisionSchema = z.object({
  expectedVersion: z.int().nonnegative(),
});
export type RestoreRevision = z.infer<typeof RestoreRevisionSchema>;
