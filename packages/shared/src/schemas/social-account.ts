import { z } from 'zod';
import { IdSchema, InstantSchema, TimestampsSchema } from './common.js';
import { PlatformSchema } from '../domain/platforms.js';
import { SocialAccountStatusSchema } from '../domain/social-accounts.js';

/** Vista pubblica: i token cifrati non escono mai dal server. */
export const SocialAccountSchema = z
  .object({
    id: IdSchema,
    brandId: IdSchema,
    platform: PlatformSchema,
    handle: z.string().nullable(),
    displayName: z.string(),
    status: SocialAccountStatusSchema,
    tokenExpiresAt: InstantSchema.nullable(),
    lastError: z.string().nullable(),
  })
  .extend(TimestampsSchema.shape);
export type SocialAccount = z.infer<typeof SocialAccountSchema>;

/** Collegamento al blog: indirizzo base della Blog API del sito e la sua chiave. */
export const BlogConnectionSchema = z.object({
  baseUrl: z.string().trim().min(1).max(500),
  apiKey: z.string().trim().min(32).max(500),
});
export type BlogConnection = z.infer<typeof BlogConnectionSchema>;
