import { z } from 'zod';
import { CarouselSchema } from './carousel.js';
import { IdSchema, InstantSchema, TimestampsSchema } from './common.js';
import { PlatformSchema, VariantFormatSchema } from '../domain/platforms.js';
import { VariantStatusSchema } from '../domain/variant-state.js';

const hashtag = z
  .string()
  .trim()
  .regex(/^#?[\p{L}\p{N}_]+$/u, 'Hashtag non valido')
  .transform((tag) => (tag.startsWith('#') ? tag : `#${tag}`));

/** Campi specifici per piattaforma; i limiti di lunghezza li verifica PublisherAdapter.validate. */
export const VariantMetadataSchema = z.object({
  hashtags: z.array(hashtag).default([]),
  title: z.string().trim().optional(),
  description: z.string().optional(),
  firstComment: z.string().optional(),
  coverAssetId: IdSchema.optional(),
  /** Slide del carosello (formato `carosello`), modificate nell'editor carosello. */
  carousel: CarouselSchema.optional(),
});
export type VariantMetadata = z.infer<typeof VariantMetadataSchema>;

export const VariantCreateSchema = z.object({
  platform: PlatformSchema,
  /** Se assente si usa il formato di default della piattaforma. */
  format: VariantFormatSchema.optional(),
  body: z.string().default(''),
  metadata: VariantMetadataSchema.default({ hashtags: [] }),
});
export type VariantCreate = z.infer<typeof VariantCreateSchema>;

export const VariantEditSchema = z.object({
  body: z.string(),
  metadata: VariantMetadataSchema,
  /** Versione letta dal client: il server rifiuta la modifica se nel frattempo è cambiata. */
  expectedVersion: z.int().nonnegative(),
});
export type VariantEdit = z.infer<typeof VariantEditSchema>;

/** Transizioni che l'utente può chiedere direttamente; le altre le gestiscono coda e scheduler. */
export const USER_VARIANT_ACTIONS = ['submit', 'approve', 'reject'] as const;

export const VariantTransitionSchema = z.object({
  action: z.enum(USER_VARIANT_ACTIONS),
  expectedVersion: z.int().nonnegative(),
});
export type VariantTransition = z.infer<typeof VariantTransitionSchema>;

export const VariantSchema = z
  .object({
    id: IdSchema,
    contentId: IdSchema,
    platform: PlatformSchema,
    format: VariantFormatSchema,
    body: z.string(),
    metadata: VariantMetadataSchema,
    status: VariantStatusSchema,
    version: z.int().nonnegative(),
    approvedAt: InstantSchema.nullable(),
  })
  .extend(TimestampsSchema.shape);
export type Variant = z.infer<typeof VariantSchema>;

export const REVISION_SOURCES = ['llm_generate', 'llm_edit', 'manuale'] as const;

export const VariantRevisionSchema = z.object({
  id: IdSchema,
  variantId: IdSchema,
  body: z.string(),
  metadata: VariantMetadataSchema,
  source: z.enum(REVISION_SOURCES),
  instruction: z.string().nullable(),
  createdAt: InstantSchema,
});
export type VariantRevision = z.infer<typeof VariantRevisionSchema>;
