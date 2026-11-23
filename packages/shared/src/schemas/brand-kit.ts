import { z } from 'zod';
import { PlatformSchema } from '../domain/platforms.js';
import { IdSchema, InstantSchema } from './common.js';

/**
 * Brand kit (V3Template): colori con un ruolo fisso, così i template dei caroselli sanno
 * quale usare per sfondo, testo, accento e codice; handle e logo per il piede delle slide;
 * regole della voce passate all'LLM. I font sono fissi (Inter e JetBrains Mono, inclusi nell'app).
 */

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colore esadecimale #RRGGBB')
  .transform((hex) => hex.toUpperCase());

export const BRAND_COLOR_ROLES = ['ink', 'paper', 'accent', 'accentSoft', 'code'] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

export const BRAND_COLOR_LABELS: Record<BrandColorRole, { name: string; use: string }> = {
  ink: { name: 'Inchiostro', use: 'testo e sfondi scuri' },
  paper: { name: 'Carta', use: 'sfondi chiari' },
  accent: { name: 'Accento', use: 'evidenze e numeri' },
  accentSoft: { name: 'Accento tenue', use: 'sottotitoli su sfondo scuro' },
  code: { name: 'Codice', use: 'snippet e terminale' },
};

export const BrandColorsSchema = z.object({
  ink: HexColorSchema,
  paper: HexColorSchema,
  accent: HexColorSchema,
  accentSoft: HexColorSchema,
  code: HexColorSchema,
});
export type BrandColors = z.infer<typeof BrandColorsSchema>;

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
