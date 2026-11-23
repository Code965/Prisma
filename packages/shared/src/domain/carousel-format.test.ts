import { describe, expect, it } from 'vitest';
import { CAROUSEL_PLATFORMS, formatForCarousel } from './carousel-format.js';

const carousel = {
  template: 'scuro' as const,
  kicker: '',
  slides: [{ kind: 'cover' as const, title: 't', body: '', code: '' }],
};

describe('formato e carosello', () => {
  it('elenca le piattaforme con i caroselli', () => {
    expect(CAROUSEL_PLATFORMS).toEqual(['linkedin', 'instagram', 'tiktok']);
  });

  it('con le slide la variant diventa carosello, senza torna al formato precedente', () => {
    expect(formatForCarousel('linkedin', 'post', {}, { carousel })).toBe('carosello');
    expect(formatForCarousel('linkedin', 'carosello', { carousel }, {})).toBe('post');
    expect(formatForCarousel('tiktok', 'carosello', { carousel }, {})).toBe('video');
    expect(formatForCarousel('instagram', 'carosello', {}, {})).toBe('carosello');
    expect(formatForCarousel('youtube', 'video', {}, { carousel })).toBe('video');
  });
});
