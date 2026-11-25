import { z } from 'zod';

/** Colori del brand kit con un ruolo fisso (separati dal kit per evitare import circolari). */

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
