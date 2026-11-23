import { z } from 'zod';
import { PlatformSchema, type Platform } from './platforms.js';

/** Uno slot consigliato: giorno della settimana (0 = lunedì) e ora, in Italia. */
export const SlotSchema = z.object({
  weekday: z.int().min(0).max(6),
  hour: z.int().min(0).max(23),
});
export type Slot = z.infer<typeof SlotSchema>;

export type SlotMap = Record<Platform, Slot[]>;

/**
 * Slot ripresi dal mockup, usati finché i post pubblicati non bastano a calcolarli dai dati
 * (fase 4c). Il blog non è nel mockup: martedì e giovedì mattina.
 */
export const DEFAULT_RECOMMENDED_SLOTS: SlotMap = {
  linkedin: [
    { weekday: 1, hour: 8 },
    { weekday: 2, hour: 8 },
    { weekday: 3, hour: 8 },
  ],
  instagram: [
    { weekday: 0, hour: 13 },
    { weekday: 2, hour: 13 },
    { weekday: 4, hour: 13 },
  ],
  tiktok: [
    { weekday: 4, hour: 21 },
    { weekday: 5, hour: 21 },
    { weekday: 6, hour: 20 },
  ],
  youtube: [
    { weekday: 3, hour: 18 },
    { weekday: 5, hour: 17 },
    { weekday: 6, hour: 17 },
  ],
  blog: [
    { weekday: 1, hour: 9 },
    { weekday: 3, hour: 9 },
  ],
};

export const PlatformSlotsSchema = z.object({
  platform: PlatformSchema,
  slots: z.array(SlotSchema),
  /** `dati` = calcolati dai post pubblicati, `predefinito` = quelli del mockup. */
  source: z.enum(['dati', 'predefinito']),
  /** Post con metriche usati per il calcolo. */
  basedOn: z.int().nonnegative(),
});
export type PlatformSlots = z.infer<typeof PlatformSlotsSchema>;

export const RecommendedSlotsSchema = z.object({ platforms: z.array(PlatformSlotsSchema) });
export type RecommendedSlots = z.infer<typeof RecommendedSlotsSchema>;

export function slotMap(recommended: RecommendedSlots | undefined): SlotMap {
  const map: SlotMap = { ...DEFAULT_RECOMMENDED_SLOTS };
  for (const entry of recommended?.platforms ?? []) map[entry.platform] = entry.slots;
  return map;
}

/** Riepilogo della Dashboard: ultimi 7 giorni per piattaforma. */
export const WeekSummarySchema = z.object({
  platforms: z.array(
    z.object({
      platform: PlatformSchema,
      /** Follower (iscritti per YouTube) all'ultimo giorno rilevato. */
      followers: z.number().nullable(),
      /** Variazione dei follower nei 7 giorni. */
      followersDelta: z.number().nullable(),
      reach: z.number().nullable(),
      /** Cosa misura `reach` su quella piattaforma. */
      reachLabel: z.string(),
    }),
  ),
});
export type WeekSummary = z.infer<typeof WeekSummarySchema>;
