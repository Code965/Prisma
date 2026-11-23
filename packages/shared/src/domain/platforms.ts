import { z } from 'zod';

/** I quattro social del mockup più il blog personale (tramite la Blog API). */
export const PLATFORMS = ['linkedin', 'instagram', 'tiktok', 'youtube', 'blog'] as const;
export const PlatformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof PlatformSchema>;

export const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  blog: 'Blog',
};

/**
 * Codici brevi usati dal design system (`--li`, `--ig`, `--tt`, `--yt` dal mockup;
 * `--bl` per il blog, che il mockup non prevede: definito in screen-tokens.css).
 */
export const PLATFORM_CODES: Record<Platform, 'li' | 'ig' | 'tt' | 'yt' | 'bl'> = {
  linkedin: 'li',
  instagram: 'ig',
  tiktok: 'tt',
  youtube: 'yt',
  blog: 'bl',
};

export const VARIANT_FORMATS = [
  'post',
  'carosello',
  'reel',
  'storia',
  'video',
  'short',
  'articolo',
] as const;
export const VariantFormatSchema = z.enum(VARIANT_FORMATS);
export type VariantFormat = z.infer<typeof VariantFormatSchema>;

/** Formati pubblicabili per ogni piattaforma. Il primo è il default. */
export const PLATFORM_FORMATS: Record<Platform, readonly VariantFormat[]> = {
  linkedin: ['post', 'carosello', 'video'],
  instagram: ['carosello', 'post', 'reel', 'storia'],
  tiktok: ['video', 'carosello'],
  youtube: ['video', 'short'],
  blog: ['articolo'],
};

/** Piattaforme social (testi brevi, generati insieme); il blog ha una generazione a parte. */
export const SOCIAL_PLATFORMS = PLATFORMS.filter((p) => p !== 'blog');

export function isFormatSupported(platform: Platform, format: VariantFormat): boolean {
  return PLATFORM_FORMATS[platform].includes(format);
}

export function defaultFormat(platform: Platform): VariantFormat {
  const [first] = PLATFORM_FORMATS[platform];
  if (!first) throw new Error(`Nessun formato definito per ${platform}`);
  return first;
}
