import {
  COMPETITOR_WINDOW_DAYS,
  type EngagementBasis,
  type ProfileStats,
  type RankedPost,
  type VariantFormat,
} from '@prisma-app/shared';
import { romeSlot } from '../analytics/slots.js';

/**
 * Statistiche di un profilo (funzioni pure), uguali per i concorrenti e per il brand stesso.
 * Interazioni = like + commenti + condivisioni (quelli noti). Il tasso di interazione si calcola
 * sulle visualizzazioni se ogni post le ha, altrimenti sui follower se si conoscono, altrimenti
 * non si calcola: le due basi non si mescolano mai nello stesso profilo.
 */

export interface StatPost {
  postId: number | null;
  title: string;
  url: string | null;
  publishedAt: Date;
  format: VariantFormat;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  /** Follower quando è stato letto il post (se noti). */
  followers: number | null;
}

const DAY = 86_400_000;
const MIN_WEEKS = 1;
const MIN_PER_SLOT = 2;
const TOP_POSTS = 5;
const BEST_SLOTS = 3;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Like + commenti + condivisioni noti; null se nessuno è noto. */
export function interactions(post: StatPost): number | null {
  const known = [post.likes, post.comments, post.shares].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  return known.length ? known.reduce((sum, v) => sum + v, 0) : null;
}

/** Base comune a tutti i post misurati del profilo. */
export function engagementBasis(
  posts: readonly StatPost[],
  followers: number | null,
): EngagementBasis | null {
  const measured = posts.filter((p) => interactions(p) !== null);
  if (measured.length === 0) return null;
  if (measured.every((p) => (p.views ?? 0) > 0)) return 'visualizzazioni';
  if (measured.every((p) => (p.followers ?? followers ?? 0) > 0)) return 'follower';
  return null;
}

function rateOf(
  post: StatPost,
  basis: EngagementBasis | null,
  followers: number | null,
): number | null {
  const total = interactions(post);
  if (total === null || !basis) return null;
  const base = basis === 'visualizzazioni' ? post.views : (post.followers ?? followers);
  return base ? total / base : null;
}

/**
 * Statistiche degli ultimi 90 giorni. Le settimane partono dal post più vecchio letto (YouTube
 * dà gli ultimi 50 video, che per un canale molto attivo coprono meno di 90 giorni).
 */
export function profileStats(
  all: readonly StatPost[],
  followers: number | null,
  now: Date,
): ProfileStats {
  const since = now.getTime() - COMPETITOR_WINDOW_DAYS * DAY;
  const posts = all.filter(
    (p) => p.publishedAt.getTime() >= since && p.publishedAt.getTime() <= now.getTime(),
  );
  const oldest = Math.min(...posts.map((p) => p.publishedAt.getTime()));
  const weeks =
    posts.length > 0
      ? Math.max(
          MIN_WEEKS,
          Math.min(COMPETITOR_WINDOW_DAYS / 7, (now.getTime() - oldest) / (7 * DAY)),
        )
      : 0;
  const lastFollowers =
    followers ??
    [...posts]
      .filter((p) => p.followers !== null)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0]?.followers ??
    null;
  const basis = engagementBasis(posts, lastFollowers);

  const ranked = posts
    .map((post) => ({ post, total: interactions(post), rate: rateOf(post, basis, lastFollowers) }))
    .filter((r): r is { post: StatPost; total: number; rate: number | null } => r.total !== null);
  // Con la base si confronta il tasso, senza il totale delle interazioni.
  const score = (r: { total: number; rate: number | null }) => (basis ? (r.rate ?? 0) : r.total);

  const byFormat = new Map<VariantFormat, typeof ranked>();
  for (const r of ranked) byFormat.set(r.post.format, [...(byFormat.get(r.post.format) ?? []), r]);
  const formats = [...byFormat.entries()]
    .map(([format, list]) => ({
      format,
      posts: list.length,
      medianRate: basis ? median(list.map((r) => r.rate ?? 0)) : null,
      medianInteractions: median(list.map((r) => r.total))!,
    }))
    .sort(
      (a, b) => (b.medianRate ?? b.medianInteractions) - (a.medianRate ?? a.medianInteractions),
    );

  const bySlot = new Map<string, typeof ranked>();
  for (const r of ranked) {
    const slot = romeSlot(r.post.publishedAt);
    const key = `${slot.weekday}:${slot.hour}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), r]);
  }
  const slots = [...bySlot.entries()]
    .filter(([, list]) => list.length >= MIN_PER_SLOT)
    .map(([key, list]) => {
      const [weekday, hour] = key.split(':').map(Number) as [number, number];
      return { weekday, hour, posts: list.length, score: median(list.map(score))! };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, BEST_SLOTS);

  const top: RankedPost[] = [...ranked]
    .sort((a, b) => score(b) - score(a) || b.total - a.total)
    .slice(0, TOP_POSTS)
    .map((r) => ({
      postId: r.post.postId,
      title: r.post.title,
      url: r.post.url,
      publishedAt: r.post.publishedAt.toISOString(),
      format: r.post.format,
      interactions: r.total,
      rate: r.rate,
    }));

  return {
    posts: posts.length,
    weeks: Math.round(weeks * 10) / 10,
    postsPerWeek: posts.length > 0 ? Math.round((posts.length / weeks) * 10) / 10 : null,
    basis,
    medianRate: basis ? median(ranked.map((r) => r.rate ?? 0)) : null,
    medianInteractions: median(ranked.map((r) => r.total)),
    followers: lastFollowers,
    formats,
    slots,
    top,
  };
}
