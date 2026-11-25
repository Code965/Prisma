import { describe, expect, it } from 'vitest';
import {
  BrandFontsSchema,
  CODE_FONT_IDS,
  DEFAULT_BRAND_FONTS,
  TEXT_FONT_IDS,
  fontStack,
  isDefaultFonts,
  usedFontIds,
} from './fonts.js';

describe('font delle slide', () => {
  it('separa i font del testo da quelli del codice', () => {
    expect(CODE_FONT_IDS).toEqual(['jetbrains-mono', 'ibm-plex-mono', 'fira-code']);
    expect(TEXT_FONT_IDS).toContain('dm-serif-display');
    expect(TEXT_FONT_IDS).not.toContain('fira-code');
    expect(BrandFontsSchema.safeParse({ ...DEFAULT_BRAND_FONTS, code: 'inter' }).success).toBe(
      false,
    );
  });

  it('elenca i font usati senza doppioni e scrive le pile CSS', () => {
    expect(usedFontIds(DEFAULT_BRAND_FONTS)).toEqual(['inter', 'jetbrains-mono']);
    expect(fontStack('playfair-display')).toBe("'Playfair Display',Georgia,serif");
    expect(isDefaultFonts(DEFAULT_BRAND_FONTS)).toBe(true);
    expect(isDefaultFonts({ ...DEFAULT_BRAND_FONTS, heading: 'sora' })).toBe(false);
  });
});
