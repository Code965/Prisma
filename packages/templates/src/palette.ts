import type { BrandColors, CarouselTemplate } from '@prisma-app/shared';
import { mixHex } from './colors.js';

/** Colori di una slide, ricavati dal brand kit secondo il template (V3Carosello). */
export interface Palette {
  bg: string;
  fg: string;
  soft: string;
  muted: string;
  accent: string;
  codeBg: string;
  codeFg: string;
}

const BLACK = '#000000';

/**
 * Con i colori predefiniti del kit i tre template riproducono quelli del mockup:
 * Tech scuro (inchiostro, accento tenue), Minimal chiaro (carta, accento), Terminale
 * (inchiostro virato sull'accento, codice in evidenza).
 */
export function templatePalette(template: CarouselTemplate, colors: BrandColors): Palette {
  const { ink, paper, accent, accentSoft, code } = colors;
  switch (template) {
    case 'scuro':
      return {
        bg: ink,
        fg: mixHex(paper, ink, 0.95),
        soft: mixHex(paper, ink, 0.78),
        muted: mixHex(paper, ink, 0.6),
        accent: accentSoft,
        codeBg: mixHex(ink, paper, 0.92),
        codeFg: mixHex(paper, ink, 0.9),
      };
    case 'chiaro':
      return {
        bg: paper,
        fg: ink,
        soft: mixHex(ink, paper, 0.82),
        muted: mixHex(ink, paper, 0.66),
        accent,
        codeBg: mixHex(ink, paper, 0.05),
        codeFg: ink,
      };
    case 'codice': {
      // Inchiostro con un velo di accento: col kit predefinito il blu notte del mockup.
      const bg = mixHex(ink, accent, 0.9);
      return {
        bg,
        fg: mixHex(paper, bg, 0.9),
        soft: mixHex(paper, bg, 0.8),
        muted: mixHex(paper, bg, 0.58),
        accent: code,
        codeBg: mixHex(bg, BLACK, 0.55),
        codeFg: code,
      };
    }
  }
}
