import { z } from 'zod';
import { IdSchema, TimestampsSchema } from './common.js';
import { PlatformSchema } from '../domain/platforms.js';
import { VariantSchema } from './variant.js';

const uniquePlatforms = z
  .array(PlatformSchema)
  .refine((list) => new Set(list).size === list.length, 'Piattaforme duplicate');

export const ContentInputSchema = z.object({
  ideaId: IdSchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  /** Crea subito una variant vuota (bozza) per ogni piattaforma indicata. */
  platforms: uniquePlatforms.default([]),
});
export type ContentInput = z.infer<typeof ContentInputSchema>;

export const ContentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type ContentUpdate = z.infer<typeof ContentUpdateSchema>;

/** Richiesta "Genera contenuti" a partire da un'idea. */
export const GenerateContentSchema = z.object({
  ideaId: IdSchema,
  platforms: uniquePlatforms.min(1),
});
export type GenerateContent = z.infer<typeof GenerateContentSchema>;

export const ContentSchema = z
  .object({
    id: IdSchema,
    brandId: IdSchema,
    ideaId: IdSchema.nullable(),
    title: z.string(),
    variants: z.array(VariantSchema),
  })
  .extend(TimestampsSchema.shape);
export type Content = z.infer<typeof ContentSchema>;
