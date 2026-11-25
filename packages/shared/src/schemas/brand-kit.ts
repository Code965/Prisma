import { BrandFontsSchema, DEFAULT_BRAND_FONTS } from './fonts.js';
import { z } from 'zod';
import { PlatformSchema } from '../domain/platforms.js';
import { BrandColorsSchema } from './brand-colors.js';
import { TemplateIdSchema } from './carousel.js';
import { CustomTemplateSchema } from './template-style.js';
import { IdSchema, InstantSchema } from './common.js';

/**
 * Brand kit (V3Template): colori con un ruolo fisso, così i template dei caroselli sanno
 * quale usare per sfondo, testo, accento e codice; handle e logo per il piede delle slide;
 * regole della voce passate all'LLM, font (7a) e template personalizzati (7b).
 */

export * from './brand-colors.js';

/** Logo come data URL (≤ 256 KB): va nelle slide esportate senza dipendere da file esterni. */
export const LOGO_MAX_BYTES = 256 * 1024;
export const LogoSchema = z
  .string()
  .regex(
    /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/,
    'Logo PNG, JPEG, WebP o SVG',
  )
  .refine((url) => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4) <= LOGO_MAX_BYTES, {
    message: 'Il logo supera 256 KB',
  });

export const BrandKitSchema = z.object({
  colors: BrandColorsSchema,
  /** Senza "@": l'interfaccia e le slide lo aggiungono. */
  handle: z
    .string()
    .trim()
    .max(60)
    .transform((h) => h.replace(/^@+/, '')),
  logo: LogoSchema.nullable(),
  voiceRules: z.array(z.string().trim().min(1).max(80)).max(20),
  /**
   * Template dei video: slide di «Crea video», schede di testo e fondo attorno allo schermo
   * (il codice usa sempre «Terminale»). Assente nei kit salvati prima: «Tech scuro».
   */
  videoTemplate: TemplateIdSchema.default('scuro'),
  /** Font di titoli, testo e codice (fase 7a). Assenti nei kit salvati prima: Inter e JetBrains Mono. */
  fonts: BrandFontsSchema.default(DEFAULT_BRAND_FONTS),
  /** Template creati dall'utente (7b/7c); i caroselli li indicano con l'id `tpl-…`. */
  templates: z.array(CustomTemplateSchema).max(12).default([]),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

/** Colori del mockup (Inchiostro, Carta, Indaco, Lavanda, Terminale). */
export const DEFAULT_BRAND_KIT: BrandKit = {
  colors: {
    ink: '#101318',
    paper: '#FFFFFF',
    accent: '#4F46E5',
    accentSoft: '#A5B4FC',
    code: '#5EEAD4',
  },
  handle: '',
  logo: null,
  voiceRules: [],
  videoTemplate: 'scuro',
  fonts: DEFAULT_BRAND_FONTS,
  templates: [],
};

export const VoiceExampleInputSchema = z.object({
  platform: PlatformSchema,
  text: z.string().trim().min(1).max(3000),
  /** Perché è un buon esempio («apertura», «tono»…): aiuta l'LLM a capire cosa imitare. */
  note: z.string().trim().max(200).default(''),
});
export type VoiceExampleInput = z.infer<typeof VoiceExampleInputSchema>;

export const VoiceExampleSchema = VoiceExampleInputSchema.extend({
  id: IdSchema,
  brandId: IdSchema,
  createdAt: InstantSchema,
});
export type VoiceExample = z.infer<typeof VoiceExampleSchema>;
