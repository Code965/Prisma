import { CarouselSchema, DEFAULT_BRAND_KIT, type VoiceExample } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  addRule,
  colorRows,
  draftKit,
  galleryCarousel,
  isDraftChanged,
  kitDraft,
  logoFileError,
  removeRule,
  voiceExampleMeta,
} from './brand-kit';

describe('brand kit', () => {
  it('rileva le modifiche ignorando maiuscole dei colori e la @ dell’handle', () => {
    const kit = { ...DEFAULT_BRAND_KIT, handle: 'marta' };
    const draft = kitDraft(kit);
    expect(isDraftChanged(draft, kit)).toBe(false);
    expect(isDraftChanged({ ...draft, handle: '@marta' }, kit)).toBe(false);
    expect(isDraftChanged({ ...draft, colors: { ...draft.colors, paper: '#ffffff' } }, kit)).toBe(
      false,
    );
    expect(isDraftChanged({ ...draft, colors: { ...draft.colors, ink: '#000000' } }, kit)).toBe(
      true,
    );
    expect(isDraftChanged({ ...draft, logo: 'data:image/png;base64,AA==' }, kit)).toBe(true);
  });

  it('elenca i colori con nome e uso', () => {
    expect(colorRows(DEFAULT_BRAND_KIT.colors)[2]).toEqual({
      role: 'accent',
      name: 'Accento',
      use: 'evidenze e numeri',
      hex: '#4F46E5',
    });
  });

  it('aggiunge regole senza vuoti né doppioni e le rimuove', () => {
    const rules = addRule(['Frasi brevi'], '  frasi   BREVI ');
    expect(rules).toEqual(['Frasi brevi']);
    expect(addRule(rules, ' Niente emoji ')).toEqual(['Frasi brevi', 'Niente emoji']);
    expect(addRule(rules, '   ')).toEqual(['Frasi brevi']);
    expect(removeRule(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('descrive gli esempi e controlla il file del logo', () => {
    const example = { platform: 'instagram', note: 'chiusura' } as VoiceExample;
    expect(voiceExampleMeta(example)).toBe('Post Instagram · chiusura');
    expect(voiceExampleMeta({ ...example, platform: 'blog', note: '' })).toBe('Articolo del blog');
    expect(logoFileError({ type: 'image/gif', size: 10 })).toMatch(/PNG/);
    expect(logoFileError({ type: 'image/png', size: 300 * 1024 })).toMatch(/256 KB/);
    expect(logoFileError({ type: 'image/svg+xml', size: 1000 })).toBeNull();
  });
});

describe('font e galleria (7a)', () => {
  it('rileva il cambio di un font', () => {
    const draft = kitDraft(DEFAULT_BRAND_KIT);
    expect(isDraftChanged(draft, DEFAULT_BRAND_KIT)).toBe(false);
    expect(
      isDraftChanged({ ...draft, fonts: { ...draft.fonts, heading: 'sora' } }, DEFAULT_BRAND_KIT),
    ).toBe(true);
  });

  it('mostra nella galleria il kit con le modifiche in bozza', () => {
    const draft = { ...kitDraft(DEFAULT_BRAND_KIT), handle: '@marta' };
    expect(draftKit(DEFAULT_BRAND_KIT, draft)).toMatchObject({ handle: 'marta', voiceRules: [] });
  });

  it('il carosello di prova è valido per ogni stile', () => {
    for (const template of ['scuro', 'chiaro', 'codice'] as const) {
      expect(CarouselSchema.parse(galleryCarousel(template)).slides).toHaveLength(3);
    }
  });
});
