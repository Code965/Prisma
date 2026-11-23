/**
 * Il campo `commentary` dei post usa il formato "little text": i caratteri riservati vanno
 * preceduti da una barra rovesciata anche se non sono usati come sintassi, altrimenti il testo
 * viene troncato o interpretato. Fonte: shares/little-text-format.
 */
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

export function escapeLittleText(text: string): string {
  return text.replace(RESERVED, (char) => `\\${char}`);
}

/** Hashtag nella forma template documentata: `{hashtag|\#|tag}`. */
export function hashtagElement(tag: string): string {
  return `{hashtag|\\#|${tag.replace(/^#/, '')}}`;
}

/** Testo del post: corpo con escape, poi gli hashtag della variant su una riga separata. */
export function buildCommentary(body: string, hashtags: readonly string[]): string {
  const text = escapeLittleText(body.trim());
  if (hashtags.length === 0) return text;
  return `${text}\n\n${hashtags.map(hashtagElement).join(' ')}`;
}

/** Testo come lo vedrà chi legge: serve per il controllo della lunghezza. */
export function visibleText(body: string, hashtags: readonly string[]): string {
  const tags = hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
  return tags ? `${body.trim()}\n\n${tags}` : body.trim();
}
