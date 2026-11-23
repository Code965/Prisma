import type { Carousel, Content, Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  addSlide,
  carouselCandidates,
  isCarouselChanged,
  moveSlide,
  patchSlide,
  removeSlide,
  slideWarnings,
  starterCarousel,
} from './carousel';

const titles = (c: Carousel) => c.slides.map((s) => s.title);

describe('operazioni sulle slide', () => {
  const base = starterCarousel('Ho costruito un client database da zero');

  it('parte da copertina, una slide e chiusura', () => {
    expect(base.slides.map((s) => s.kind)).toEqual(['cover', 'text', 'cta']);
    expect(base.slides[0]!.title).toBe('Ho costruito un client database da zero');
  });

  it('aggiunge dopo la selezionata, fino a 10 slide', () => {
    const added = addSlide(base, 0);
    expect(added.index).toBe(1);
    expect(titles(added.carousel)[1]).toBe('Nuova slide');
    let full = base;
    for (let i = 0; i < 10; i++) full = addSlide(full, 0).carousel;
    expect(full.slides).toHaveLength(10);
  });

  it('rimuove tenendo almeno una slide e sposta la selezione', () => {
    const removed = removeSlide(base, 2);
    expect(removed.index).toBe(1);
    expect(removed.carousel.slides).toHaveLength(2);
    const single = { ...base, slides: [base.slides[0]!] };
    expect(removeSlide(single, 0).carousel.slides).toHaveLength(1);
  });

  it('sposta le slide entro i limiti', () => {
    const moved = moveSlide(base, 0, 1);
    expect(moved.index).toBe(1);
    expect(titles(moved.carousel)[1]).toBe(base.slides[0]!.title);
    expect(moveSlide(base, 0, -1)).toEqual({ carousel: base, index: 0 });
  });

  it('modifica una slide e rileva le modifiche', () => {
    const patched = patchSlide(base, 1, { title: 'Altro' });
    expect(titles(patched)[1]).toBe('Altro');
    expect(isCarouselChanged(patched, base)).toBe(true);
    expect(isCarouselChanged(base, structuredClone(base))).toBe(false);
    expect(isCarouselChanged(base, undefined)).toBe(true);
  });

  it('segnala titoli lunghi, elenchi e codice vuoti', () => {
    expect(slideWarnings({ kind: 'list', title: 'x'.repeat(61), body: '\n', code: '' })).toEqual([
      'Titolo oltre i 60 caratteri consigliati',
      'Elenco senza punti: scrivine uno per riga',
    ]);
    expect(slideWarnings({ kind: 'code', title: '', body: '', code: ' ' })).toEqual([
      'Manca il titolo',
      'Manca il codice',
    ]);
  });
});

describe('carouselCandidates', () => {
  it('tiene solo i contenuti con LinkedIn, Instagram o TikTok', () => {
    const variant = (platform: Variant['platform']) => ({ platform }) as Variant;
    const contents = [
      { id: 1, variants: [variant('youtube'), variant('instagram')] },
      { id: 2, variants: [variant('blog')] },
    ] as Content[];
    const result = carouselCandidates(contents);
    expect(result.map((r) => r.content.id)).toEqual([1]);
    expect(result[0]!.variants.map((v) => v.platform)).toEqual(['instagram']);
  });
});
