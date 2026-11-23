import sanitizeHtml from 'sanitize-html';

/**
 * HTML ammesso negli articoli del blog: struttura e formattazione del testo, link e codice.
 * Niente script, stili, iframe o attributi di evento. Il titolo è un campo a parte, quindi
 * eventuali <h1> diventano <h2>. Le immagini arriveranno con gli asset (fase 2).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h2',
    'h3',
    'h4',
    'p',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'b',
    'i',
    'code',
    'pre',
    'blockquote',
    'a',
    'br',
    'hr',
  ],
  // `rel` è ammesso solo perché lo aggiunge transformTags: altrimenti verrebbe tolto subito.
  allowedAttributes: { a: ['href', 'title', 'rel'] },
  allowedSchemes: ['https', 'http', 'mailto'],
  transformTags: {
    h1: 'h2',
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** Testo leggibile dell'articolo (senza tag), per conteggi e controlli. */
export function articleText(html: string): string {
  // Uno spazio al posto di ogni tag: "<h2>Uno</h2><p>due</p>" diventa "Uno due", non "Unodue".
  const spaced = html.replace(/</g, ' <');
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(html: string): number {
  const text = articleText(html);
  return text ? text.split(' ').length : 0;
}
