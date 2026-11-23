import { z } from 'zod';
import { IdSchema, InstantSchema, TimestampsSchema } from './common.js';
import { PublicationStatusSchema } from '../domain/publication-state.js';
import { PlatformSchema, VariantFormatSchema } from '../domain/platforms.js';

export const ScheduleSchema = z.object({
  variantId: IdSchema,
  socialAccountId: IdSchema,
  scheduledAt: InstantSchema,
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const RescheduleSchema = z.object({ scheduledAt: InstantSchema });
export type Reschedule = z.infer<typeof RescheduleSchema>;

export const PublicationSchema = z
  .object({
    id: IdSchema,
    variantId: IdSchema,
    socialAccountId: IdSchema,
    scheduledAt: InstantSchema,
    status: PublicationStatusSchema,
    attempts: z.int().nonnegative(),
    maxAttempts: z.int().positive(),
    nextAttemptAt: InstantSchema.nullable(),
    externalId: z.string().nullable(),
    externalUrl: z.url().nullable(),
    lastError: z.string().nullable(),
    publishedAt: InstantSchema.nullable(),
  })
  .extend(TimestampsSchema.shape);
export type Publication = z.infer<typeof PublicationSchema>;

/** Pubblicazione con i dati del contenuto che servono a calendario e coda. */
export const PublicationViewSchema = PublicationSchema.extend({
  platform: PlatformSchema,
  format: VariantFormatSchema,
  contentId: IdSchema,
  contentTitle: z.string(),
});
export type PublicationView = z.infer<typeof PublicationViewSchema>;

export const PublicationListQuerySchema = z.object({
  brandId: z.coerce.number().int().positive(),
  from: InstantSchema.optional(),
  to: InstantSchema.optional(),
  status: z
    .union([PublicationStatusSchema, z.array(PublicationStatusSchema)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
});
export type PublicationListQuery = z.infer<typeof PublicationListQuerySchema>;

export const ATTEMPT_OUTCOMES = ['successo', 'errore_temporaneo', 'errore_definitivo'] as const;

export const PublicationAttemptSchema = z.object({
  id: IdSchema,
  publicationId: IdSchema,
  attemptNo: z.int().positive(),
  startedAt: InstantSchema,
  finishedAt: InstantSchema.nullable(),
  outcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
  error: z.string().nullable(),
});
export type PublicationAttempt = z.infer<typeof PublicationAttemptSchema>;

/** Controllo dei requisiti mostrato in coda: `ok` verificato, `warning` da guardare, `error` blocca. */
export const QueueCheckSchema = z.object({
  level: z.enum(['ok', 'warning', 'error']),
  message: z.string(),
});
export type QueueCheck = z.infer<typeof QueueCheckSchema>;

export const PublicationChecksSchema = z.object({
  publicationId: IdSchema,
  checks: z.array(QueueCheckSchema),
});
export type PublicationChecks = z.infer<typeof PublicationChecksSchema>;
