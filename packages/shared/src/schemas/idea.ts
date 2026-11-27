import { z } from 'zod';
import { IdSchema, TimestampsSchema } from './common.js';
import { IdeaSourceSchema, IdeaStatusSchema } from '../domain/ideas.js';
import { PlatformSchema } from '../domain/platforms.js';
import { IdeaInspirationSchema } from './inspiration.js';

export const TagSchema = z.object({
  id: IdSchema,
  brandId: IdSchema,
  name: z.string().trim().min(1).max(40),
});
export type Tag = z.infer<typeof TagSchema>;

export const TagInputSchema = TagSchema.pick({ name: true });
export type TagInput = z.infer<typeof TagInputSchema>;

const targetPlatforms = z
  .array(PlatformSchema)
  .refine((list) => new Set(list).size === list.length, 'Piattaforme duplicate');

export const IdeaInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  source: IdeaSourceSchema.default('scritta'),
  tagIds: z.array(IdSchema).default([]),
  targetPlatforms: targetPlatforms.default([]),
  /** Post d'origine di un'idea nata da «Ispirati». */
  inspiration: IdeaInspirationSchema.nullish(),
});
export type IdeaInput = z.infer<typeof IdeaInputSchema>;

export const IdeaUpdateSchema = z.object({
  text: z.string().trim().min(1).max(4000).optional(),
  tagIds: z.array(IdSchema).optional(),
  targetPlatforms: targetPlatforms.optional(),
  status: IdeaStatusSchema.optional(),
});
export type IdeaUpdate = z.infer<typeof IdeaUpdateSchema>;

export const IdeaListQuerySchema = z.object({
  status: IdeaStatusSchema.optional(),
  tagId: z.coerce.number().int().positive().optional(),
});
export type IdeaListQuery = z.infer<typeof IdeaListQuerySchema>;

export const IdeaSchema = z
  .object({
    id: IdSchema,
    brandId: IdSchema,
    text: z.string(),
    source: IdeaSourceSchema,
    status: IdeaStatusSchema,
    tags: z.array(TagSchema),
    targetPlatforms: z.array(PlatformSchema),
    inspiration: IdeaInspirationSchema.nullable().default(null),
  })
  .extend(TimestampsSchema.shape);
export type Idea = z.infer<typeof IdeaSchema>;
