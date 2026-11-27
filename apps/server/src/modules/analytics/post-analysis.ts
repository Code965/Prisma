import {
  POST_ANALYSIS_MIN_GROUP,
  POST_ANALYSIS_PLATFORMS,
  POST_ANALYSIS_WINDOW_DAYS,
  POST_DIMENSIONS,
  POST_FORMAT_LABELS,
  type AnalyzedPost,
  type Platform,
  type PlatformPostAnalysis,
  type PostDimension,
  type PostGroup,
  type PublicationMetrics,
  type VariantFormat,
} from '@prisma-app/shared';
import {
  engagementBasis,
  interactions,
  median,
  rateOf,
  type StatPost,
} from '../competitors/stats.js';
import { romeSlot } from './slots.js';

/**
 * Analisi dei propri post (fase 8d), funzioni pure. Stesse regole dei concorrenti (`stats.ts`):
 * interazioni = like + commenti + condivisioni noti, tasso sulle visualizzazioni (o impressioni)
 * se ogni post le ha, altrimenti sui follower, altrimenti nessun tasso.
 */

export interface OwnPost {
  publicationId: number;
  platform: Platform;
  title: string;
  url: string | null;
  publishedAt: Date;
  format: VariantFormat;
  /** Testo della variant. */
  body: string;
  /** Titolo della variant (YouTube), se c'è. */
  heading: string | null;
  /** Tag dell'idea da cui è nato il contenuto. */
  tags: string[];
  metrics: PublicationMetrics | null;
}

const DAY = 86_400_000;
const OPENING_MAX = 140;
const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const NO_TOPIC = 'Senza argomento';

/** Fasce di lunghezza in parole (hashtag esclusi). */
export const LENGTH_BANDS = [
  { key: 'breve', label: 'Breve (meno di 50 parole)', max: 50 },
  { key: 'media', label: 'Media (50–149 parole)', max: 150 },
  { key: 'lunga', label: 'Lunga (150–299 parole)', max: 300 },
  { key: 'molto-lunga', label: 'Molto lunga (300 parole o più)', max: Infinity },
] as const;

export const DAY_PARTS = [
  { key: 'notte', label: 'Notte (0–6)', until: 6 },
  { key: 'mattina', label: 'Mattina (6–12)', until: 12 },
  { key: 'pomeriggio', label: 'Pomeriggio (12–18)', until: 18 },
  { key: 'sera', label: 'Sera (18–24)', until: 24 },
] as const;

export function wordCount(text: string): number {
  return text
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !w.startsWith('#')).length;
}

/** Prima frase non vuota del testo (o il titolo, se c'è), al massimo 140 caratteri. */
export function openingOf(body: string, heading: string | null): string {
  const source = heading?.trim() || body.replace(/<[^>]+>/g, ' ');
  const line = source
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return '';
  const sentence = /^.+?[.!?…](?=\s|$)/u.exec(line)?.[0] ?? line;
  return sentence.length > OPENING_MAX ? `${sentence.slice(0, OPENING_MAX - 1)}…` : sentence;
}

/** Tipo di apertura da regole semplici; l'AI può sostituirlo con una classificazione migliore. */
export function openingKind(opening: string): string {
  const text = opening.trim().toLowerCase();
  if (!text) return 'Senza testo';
  if (text.includes('?')) return 'Domanda';
  if (/^(\d|uno |due |tre |quattro |cinque |sei |sette |otto |nove |dieci )/.test(text)) {
    return 'Numero o elenco';
  }
  if (/^(come |ecco |guida|tutorial|passo |perch[eé] )/.test(text)) return 'Come fare / perché';
  if (/^(ho |sono |abbiamo |la mia |il mio |quando ho |ieri |oggi |questa settimana )/.test(text)) {
    return 'Esperienza personale';
  }
  return 'Affermazione';
}

export function lengthBand(words: number) {
  return LENGTH_BANDS.find((b) => words < b.max)!;
}

export function dayPart(hour: number) {
  return DAY_PARTS.find((p) => hour < p.until)!;
}

interface Scored {
  post: AnalyzedPost;
  total: number;
  rate: number | null;
}

/** Chiavi ed etichette di un post per ogni dimensione (un post può avere più argomenti). */
function keysOf(post: AnalyzedPost, words: number): Record<PostDimension, [string, string][]> {
  const slot = romeSlot(new Date(post.publishedAt));
  const band = lengthBand(words);
  const part = dayPart(slot.hour);
  return {
    argomento: post.tags.length ? post.tags.map((t) => [t, t]) : [['', NO_TOPIC]],
    formato: [[post.format, POST_FORMAT_LABELS[post.format]]],
    apertura: [[post.openingKind, post.openingKind]],
    lunghezza: [[band.key, band.label]],
    giorno: [[String(slot.weekday), WEEKDAYS[slot.weekday]!]],
    fascia: [[part.key, part.label]],
  };
}

function groupsOf(
  scored: readonly Scored[],
  dimension: PostDimension,
  hasBasis: boolean,
): PostGroup[] {
  const map = new Map<string, { label: string; list: Scored[] }>();
  for (const s of scored) {
    for (const [key, label] of keysOf(s.post, s.post.words)[dimension]) {
      const entry = map.get(key) ?? { label, list: [] };
      entry.list.push(s);
      map.set(key, entry);
    }
  }
  const groups = [...map.entries()].map(([key, { label, list }]) => ({
    key,
    label,
    posts: list.length,
    medianRate: hasBasis ? median(list.map((s) => s.rate ?? 0)) : null,
    medianInteractions: median(list.map((s) => s.total)),
    fewData: list.length < POST_ANALYSIS_MIN_GROUP,
    publicationIds: list.map((s) => s.post.publicationId),
  }));
  const score = (g: PostGroup) => (hasBasis ? (g.medianRate ?? 0) : (g.medianInteractions ?? 0));
  // Prima i gruppi con abbastanza post, dal migliore; quelli con pochi dati in fondo.
  return groups.sort(
    (a, b) => Number(a.fewData) - Number(b.fewData) || score(b) - score(a) || b.posts - a.posts,
  );
}

function statPost(post: OwnPost): StatPost {
  const m = post.metrics;
  return {
    postId: post.publicationId,
    title: post.title,
    url: post.url,
    publishedAt: post.publishedAt,
    format: post.format,
    likes: m?.likes ?? null,
    comments: m?.comments ?? null,
    shares: m?.shares ?? null,
    views: m ? (m.views ?? m.impressions) : null,
    followers: null,
  };
}

/**
 * Analisi di una piattaforma. `openings` (id della pubblicazione → etichetta) sostituisce il tipo
 * di apertura delle regole, quando l'AI ha classificato i post.
 */
export function analyzePlatform(
  platform: (typeof POST_ANALYSIS_PLATFORMS)[number],
  all: readonly OwnPost[],
  followers: number | null,
  now: Date,
  openings?: ReadonlyMap<number, string>,
): PlatformPostAnalysis {
  const since = now.getTime() - POST_ANALYSIS_WINDOW_DAYS * DAY;
  const posts = all.filter(
    (p) =>
      p.platform === platform &&
      p.publishedAt.getTime() >= since &&
      p.publishedAt.getTime() <= now.getTime(),
  );
  const stats = posts.map(statPost);
  const basis = engagementBasis(stats, followers);
  const analyzed = posts
    .map((post, i): AnalyzedPost => {
      const opening = openingOf(post.body, post.heading);
      return {
        publicationId: post.publicationId,
        title: post.title,
        url: post.url,
        publishedAt: post.publishedAt.toISOString(),
        format: post.format,
        tags: post.tags,
        words: wordCount(post.body),
        opening,
        openingKind: openings?.get(post.publicationId) ?? openingKind(opening),
        interactions: interactions(stats[i]!),
        rate: rateOf(stats[i]!, basis, followers),
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const scored = analyzed
    .filter((p) => p.interactions !== null)
    .map((post) => ({ post, total: post.interactions!, rate: post.rate }));
  return {
    platform,
    published: posts.length,
    measured: scored.length,
    basis,
    medianRate: basis ? median(scored.map((s) => s.rate ?? 0)) : null,
    medianInteractions: median(scored.map((s) => s.total)),
    dimensions: POST_DIMENSIONS.map((dimension) => ({
      dimension,
      groups: groupsOf(scored, dimension, basis !== null),
    })),
    posts: analyzed,
  };
}

/** Tutte le piattaforme con almeno un post pubblicato nella finestra. */
export function analyzePosts(
  posts: readonly OwnPost[],
  followers: Partial<Record<Platform, number | null>>,
  now: Date,
  openings?: ReadonlyMap<number, string>,
): PlatformPostAnalysis[] {
  return POST_ANALYSIS_PLATFORMS.map((platform) =>
    analyzePlatform(platform, posts, followers[platform] ?? null, now, openings),
  ).filter((p) => p.published > 0);
}
