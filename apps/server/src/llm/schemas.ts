import {
  CAROUSEL_LIMITS,
  PlatformSchema,
  SLIDE_KINDS,
  type VariantMetadata,
} from '@prisma-app/shared';
import { z } from 'zod';

/** Il modello a volte aggiunge "#" o spazi: si normalizza e si scarta ciò che non è un hashtag. */
export const hashtags = z
  .array(z.string())
  .default([])
  .transform((list) =>
    list
      .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, ''))
      .filter((tag) => /^[\p{L}\p{N}_]+$/u.test(tag))
      .map((tag) => `#${tag}`),
  );

export const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

const variantFields = {
  body: z.string().trim().min(1),
  hashtags,
  title: optionalText,
  description: optionalText,
  firstComment: optionalText,
};

export const GeneratedContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  variants: z.array(z.object({ platform: PlatformSchema, ...variantFields })).min(1),
});
export type GeneratedContent = z.infer<typeof GeneratedContentSchema>;

/** Articolo del blog: generato con una chiamata a parte, perché è molto più lungo dei post. */
export const GeneratedArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1),
  body: z.string().trim().min(1),
  hashtags,
});
export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>;

export const EditedVariantSchema = z.object({
  reply: z.string().trim().min(1),
  ...variantFields,
});
export type EditedVariant = z.infer<typeof EditedVariantSchema>;

type GeneratedFields = Pick<EditedVariant, 'hashtags' | 'title' | 'description' | 'firstComment'>;

/** Converte i campi prodotti dal modello nei metadata della variant, senza chiavi vuote. */
export function toMetadata(
  fields: GeneratedFields,
  keep: Partial<VariantMetadata> = {},
): VariantMetadata {
  const metadata: VariantMetadata = { ...keep, hashtags: fields.hashtags };
  if (fields.title) metadata.title = fields.title;
  else delete metadata.title;
  if (fields.description) metadata.description = fields.description;
  else delete metadata.description;
  if (fields.firstComment) metadata.firstComment = fields.firstComment;
  else delete metadata.firstComment;
  return metadata;
}

// --- Carosello ------------------------------------------------------------------------------

const slideText = z
  .string()
  .nullish()
  .transform((value) => (value ?? '').trim());

export const GeneratedSlideSchema = z.object({
  kind: z.enum(SLIDE_KINDS),
  title: z.string().trim().min(1).max(CAROUSEL_LIMITS.titleMax),
  body: slideText.pipe(z.string().max(CAROUSEL_LIMITS.bodyMax)),
  code: slideText.pipe(z.string().max(CAROUSEL_LIMITS.codeMax)),
});

const kicker = z
  .string()
  .nullish()
  .transform((value) => (value ?? '').trim().slice(0, CAROUSEL_LIMITS.kickerMax));

export const GeneratedCarouselSchema = z.object({
  kicker,
  slides: z.array(GeneratedSlideSchema).min(3).max(CAROUSEL_LIMITS.maxSlides),
});
export type GeneratedCarousel = z.infer<typeof GeneratedCarouselSchema>;

/** Modifica: o le slide aggiornate, o fino a tre proposte di titolo (slide null). */
export const EditedCarouselSchema = z
  .object({
    reply: z.string().trim().min(1),
    kicker: kicker.optional(),
    slides: z
      .array(GeneratedSlideSchema)
      .min(CAROUSEL_LIMITS.minSlides)
      .max(CAROUSEL_LIMITS.maxSlides)
      .nullish(),
    proposals: z
      .array(z.string().trim().min(1).max(CAROUSEL_LIMITS.titleMax))
      .max(3)
      .nullish()
      .transform((list) => list ?? []),
  })
  .refine((value) => Boolean(value.slides) || value.proposals.length > 0, {
    message: 'Servono "slides" (modifica) oppure "proposals" (proposte di titolo)',
  });
export type EditedCarousel = z.infer<typeof EditedCarouselSchema>;
