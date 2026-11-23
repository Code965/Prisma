import { describe, expect, it } from 'vitest';
import {
  BrandKitSchema,
  DEFAULT_BRAND_KIT,
  LOGO_MAX_BYTES,
  VoiceExampleInputSchema,
} from './brand-kit.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('brand kit', () => {
  it('normalizza colori e handle', () => {
    const kit = BrandKitSchema.parse({
      ...DEFAULT_BRAND_KIT,
      colors: { ...DEFAULT_BRAND_KIT.colors, accent: '#4f46e5' },
      handle: ' @marta.dev ',
      logo: PNG,
    });
    expect(kit.colors.accent).toBe('#4F46E5');
    expect(kit.handle).toBe('marta.dev');
  });

  it('rifiuta colori non esadecimali e loghi non immagine o troppo grandi', () => {
    const bad = (patch: object) =>
      BrandKitSchema.safeParse({ ...DEFAULT_BRAND_KIT, ...patch }).success;
    expect(bad({ colors: { ...DEFAULT_BRAND_KIT.colors, ink: 'red' } })).toBe(false);
    expect(bad({ logo: 'data:text/html;base64,PHNjcmlwdD4=' })).toBe(false);
    expect(bad({ logo: 'https://example.com/logo.png' })).toBe(false);
    const huge = `data:image/png;base64,${'A'.repeat(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 8)}`;
    expect(bad({ logo: huge })).toBe(false);
    expect(bad({ logo: PNG })).toBe(true);
  });

  it('esempio di voce con nota facoltativa', () => {
    expect(VoiceExampleInputSchema.parse({ platform: 'linkedin', text: ' Ciao ' })).toEqual({
      platform: 'linkedin',
      text: 'Ciao',
      note: '',
    });
  });
});
