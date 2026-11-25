import { z } from 'zod';

/**
 * Font open source inclusi nell'app (pacchetti @fontsource, licenza OFL-1.1) per slide, schede
 * dei video e anteprime: funzionano offline e finiscono incorporati negli export. Qui solo il
 * catalogo; i file li forniscono il renderer (indirizzi) e il main di Electron (data URL).
 */
export const SLIDE_FONTS = {
  inter: {
    label: 'Inter',
    family: 'Inter',
    kind: 'sans',
    weights: [400, 600, 700, 800],
    titleWeight: 800,
  },
  'space-grotesk': {
    label: 'Space Grotesk',
    family: 'Space Grotesk',
    kind: 'sans',
    weights: [400, 600, 700],
    titleWeight: 700,
  },
  poppins: {
    label: 'Poppins',
    family: 'Poppins',
    kind: 'sans',
    weights: [400, 600, 700, 800],
    titleWeight: 800,
  },
  manrope: {
    label: 'Manrope',
    family: 'Manrope',
    kind: 'sans',
    weights: [400, 600, 700, 800],
    titleWeight: 800,
  },
  'ibm-plex-sans': {
    label: 'IBM Plex Sans',
    family: 'IBM Plex Sans',
    kind: 'sans',
    weights: [400, 600, 700],
    titleWeight: 700,
  },
  sora: {
    label: 'Sora',
    family: 'Sora',
    kind: 'sans',
    weights: [400, 600, 700, 800],
    titleWeight: 800,
  },
  'playfair-display': {
    label: 'Playfair Display',
    family: 'Playfair Display',
    kind: 'serif',
    weights: [400, 600, 700],
    titleWeight: 700,
  },
  'dm-serif-display': {
    label: 'DM Serif Display',
    family: 'DM Serif Display',
    kind: 'serif',
    weights: [400],
    titleWeight: 400,
  },
  'jetbrains-mono': {
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    kind: 'mono',
    weights: [400, 500],
    titleWeight: 500,
  },
  'ibm-plex-mono': {
    label: 'IBM Plex Mono',
    family: 'IBM Plex Mono',
    kind: 'mono',
    weights: [400, 500],
    titleWeight: 500,
  },
  'fira-code': {
    label: 'Fira Code',
    family: 'Fira Code',
    kind: 'mono',
    weights: [400, 500],
    titleWeight: 500,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    family: string;
    kind: 'sans' | 'serif' | 'mono';
    weights: readonly number[];
    titleWeight: number;
  }
>;

export type SlideFontId = keyof typeof SLIDE_FONTS;
export const SLIDE_FONT_IDS = Object.keys(SLIDE_FONTS) as SlideFontId[];

/** Titoli e testo: tutti i font tranne quelli a spaziatura fissa (che sono per il codice). */
export const TEXT_FONT_IDS = SLIDE_FONT_IDS.filter((id) => SLIDE_FONTS[id].kind !== 'mono') as [
  SlideFontId,
  ...SlideFontId[],
];
export const CODE_FONT_IDS = SLIDE_FONT_IDS.filter((id) => SLIDE_FONTS[id].kind === 'mono') as [
  SlideFontId,
  ...SlideFontId[],
];

export const BrandFontsSchema = z.object({
  heading: z.enum(TEXT_FONT_IDS),
  body: z.enum(TEXT_FONT_IDS),
  /** Codice, numeri, etichette tecniche e iniziali. */
  code: z.enum(CODE_FONT_IDS),
});
export type BrandFonts = z.infer<typeof BrandFontsSchema>;

/** I font di sempre: i kit salvati prima della scelta dei font restano identici. */
export const DEFAULT_BRAND_FONTS: BrandFonts = {
  heading: 'inter',
  body: 'inter',
  code: 'jetbrains-mono',
};

export function isDefaultFonts(fonts: BrandFonts): boolean {
  return (
    fonts.heading === DEFAULT_BRAND_FONTS.heading &&
    fonts.body === DEFAULT_BRAND_FONTS.body &&
    fonts.code === DEFAULT_BRAND_FONTS.code
  );
}

/** Font da caricare per un kit, senza doppioni. */
export function usedFontIds(fonts: BrandFonts): SlideFontId[] {
  return [...new Set([fonts.heading, fonts.body, fonts.code])];
}

const FALLBACK = {
  sans: 'system-ui,sans-serif',
  serif: 'Georgia,serif',
  mono: 'ui-monospace,monospace',
};

/** `'Space Grotesk',system-ui,sans-serif` per il CSS. */
export function fontStack(id: SlideFontId): string {
  const font = SLIDE_FONTS[id];
  return `'${font.family}',${FALLBACK[font.kind]}`;
}
