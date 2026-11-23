import type { Variant } from '../schemas/variant.js';

/**
 * Didascalia di un post social: testo e hashtag in fondo, separati da una riga vuota. Per TikTok
 * è quella da incollare nell'app (il caricamento nella casella non porta il testo).
 */
export function socialCaption(variant: Pick<Variant, 'body' | 'metadata'>): string {
  const text = variant.body.trim();
  const tags = variant.metadata.hashtags.join(' ');
  return tags ? `${text}\n\n${tags}` : text;
}
