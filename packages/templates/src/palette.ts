import {
  resolveTemplate,
  type BrandColors,
  type CustomTemplate,
  type TemplateId,
  type TemplateTone,
} from '@prisma-app/shared';
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
export function templatePalette(
  template: TemplateId,
  colors: BrandColors,
  templates?: readonly CustomTemplate[],
): Palette {
  return tonePalette(resolveTemplate(template, templates).style.tone, colors);
}

/** Colori di un tono (7b): gli stili pronti e i template del kit ne scelgono uno. */
export function tonePalette(tone: TemplateTone, colors: BrandColors): Palette {
  const { ink, paper, accent, accentSoft, code } = colors;
  switch (tone) {
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
    case 'accento':
      // Fondo pieno del colore accento, testo chiaro; numeri e accenti nell'inchiostro.
      return {
        bg: accent,
        fg: mixHex(paper, accent, 0.96),
        soft: mixHex(paper, accent, 0.84),
        muted: mixHex(paper, accent, 0.66),
        accent: ink,
        codeBg: mixHex(ink, accent, 0.88),
        codeFg: code,
      };
  }
}
