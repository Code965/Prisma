import type { VariantMetadata } from '../schemas/variant.js';
import {
  PLATFORM_FORMATS,
  PLATFORMS,
  isFormatSupported,
  type Platform,
  type VariantFormat,
} from './platforms.js';

/** Piattaforme che pubblicano caroselli (LinkedIn come PDF, Instagram e TikTok come immagini). */
export const CAROUSEL_PLATFORMS: readonly Platform[] = PLATFORMS.filter((p) =>
  isFormatSupported(p, 'carosello'),
);

/**
 * Il formato segue le slide: con un carosello la variant diventa `carosello`; se le slide
 * vengono tolte torna al primo formato non carosello della piattaforma. Negli altri casi resta.
 */
export function formatForCarousel(
  platform: Platform,
  current: VariantFormat,
  previous: Pick<VariantMetadata, 'carousel'>,
  next: Pick<VariantMetadata, 'carousel'>,
): VariantFormat {
  if (next.carousel && isFormatSupported(platform, 'carosello')) return 'carosello';
  if (!next.carousel && previous.carousel && current === 'carosello') {
    return PLATFORM_FORMATS[platform].find((f) => f !== 'carosello') ?? current;
  }
  return current;
}
