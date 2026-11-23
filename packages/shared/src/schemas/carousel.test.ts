import { describe, expect, it } from 'vitest';
import { CarouselSchema, slideListItems } from './carousel.js';
import { VariantMetadataSchema } from './variant.js';

describe('carosello', () => {
  it('applica i default e accetta il carosello nei metadata della variant', () => {
    const carousel = CarouselSchema.parse({ slides: [{ kind: 'cover', title: ' Titolo ' }] });
    expect(carousel).toEqual({
      template: 'scuro',
      kicker: '',
      slides: [{ kind: 'cover', title: 'Titolo', body: '', code: '' }],
    });
    expect(VariantMetadataSchema.parse({ carousel }).carousel).toEqual(carousel);
  });

  it('limita il numero di slide', () => {
    const slide = { kind: 'text', title: 't' };
    expect(CarouselSchema.safeParse({ slides: [] }).success).toBe(false);
    expect(CarouselSchema.safeParse({ slides: Array(11).fill(slide) }).success).toBe(false);
    expect(CarouselSchema.safeParse({ slides: Array(10).fill(slide) }).success).toBe(true);
  });

  it('ricava i punti di un elenco dalle righe non vuote', () => {
    expect(slideListItems('C# e .NET\n\n  Avalonia  \n')).toEqual(['C# e .NET', 'Avalonia']);
  });
});
