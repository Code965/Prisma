import { z } from 'zod';

export const IdSchema = z.int().positive();
export type Id = z.infer<typeof IdSchema>;

/** Istante in ISO 8601 con offset esplicito; il server lo salva in UTC. */
export const InstantSchema = z.iso.datetime({ offset: true });

export const TimestampsSchema = z.object({
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
