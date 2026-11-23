import { UI_TIME_ZONE } from './dates';

/**
 * Anteprima dell'articolo del blog. L'HTML della bozza (anche non ancora salvata, quindi non
 * ripulito dal server) non finisce mai in `innerHTML`: si legge con DOMParser, che non esegue
 * script, e si ricostruisce un albero con i soli tag ammessi da `content/article-html.ts` del
 * server. Il componente lo trasforma in elementi React.
 */

export type ArticleTag =
  | 'h2'
  | 'h3'
  | 'h4'
  | 'p'
  | 'ul'
  | 'ol'
  | 'li'
  | 'strong'
  | 'em'
  | 'b'
  | 'i'
  | 'code'
  | 'pre'
  | 'blockquote'
  | 'a'
  | 'br'
  | 'hr';

export type ArticleNode =
  | { kind: 'text'; text: string }
  | { kind: 'element'; tag: ArticleTag; href?: string; children: ArticleNode[] };

const ALLOWED = new Set<string>([
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
]);

/** Come sul server: h1 diventa h2 (il titolo della pagina è già un h1). */
const RENAMED: Record<string, ArticleTag> = { h1: 'h2' };

/** Tag scartati insieme al contenuto; gli altri non ammessi lasciano il testo che contengono. */
const DROPPED = new Set([
  'script',
  'style',
  'textarea',
  'option',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'title',
]);

/** Solo link web o email: niente `javascript:`, `data:` e simili. */
export function safeHref(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function convert(node: Node): ArticleNode[] {
  if (node.nodeType === 3) return [{ kind: 'text', text: node.textContent ?? '' }];
  if (node.nodeType !== 1) return [];
  const element = node as Element;
  const name = element.tagName.toLowerCase();
  if (DROPPED.has(name)) return [];
  const children = Array.from(element.childNodes).flatMap(convert);
  const tag = RENAMED[name] ?? (ALLOWED.has(name) ? (name as ArticleTag) : null);
  if (!tag) return children;
  if (tag === 'a')
    return [{ kind: 'element', tag, href: safeHref(element.getAttribute('href')), children }];
  if (tag === 'br' || tag === 'hr') return [{ kind: 'element', tag, children: [] }];
  return [{ kind: 'element', tag, children }];
}

export function parseArticle(html: string): ArticleNode[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.childNodes).flatMap(convert);
}

/** Testo semplice dell'albero, con uno spazio tra un blocco e l'altro (per contare le parole). */
export function articleText(nodes: ArticleNode[]): string {
  return nodes
    .map((n) => (n.kind === 'text' ? n.text : ` ${articleText(n.children)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minuti di lettura: 200 parole al minuto, arrotondati per eccesso. */
export function readingMinutes(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.ceil(words / 200));
}

export function readingTimeLabel(minutes: number): string {
  return `Lo leggi in ${minutes} minut${minutes > 1 ? 'i' : 'o'}`;
}

/** Data in testa all'articolo («22 novembre 2026»). */
export function articleDate(date: Date, timeZone = UI_TIME_ZONE): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
}
