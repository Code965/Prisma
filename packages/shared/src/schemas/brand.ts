import { z } from 'zod';
import { IdSchema, TimestampsSchema } from './common.js';

export const BrandInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  initials: z.string().trim().min(1).max(3),
  timezone: z.string().min(1).default('Europe/Rome'),
});
export type BrandInput = z.infer<typeof BrandInputSchema>;

export const BrandSchema = BrandInputSchema.extend({ id: IdSchema }).extend(TimestampsSchema.shape);
export type Brand = z.infer<typeof BrandSchema>;

/** Esplicito invece di `.partial()`: i default non devono riapplicarsi a un aggiornamento parziale. */
export const BrandUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  initials: z.string().trim().min(1).max(3).optional(),
  timezone: z.string().min(1).optional(),
});
export type BrandUpdate = z.infer<typeof BrandUpdateSchema>;
