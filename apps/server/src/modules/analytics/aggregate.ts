import type { ANALYTICS_PLATFORMS } from '@prisma-app/shared';
import {
  interactionsOf,
  type AnalyticsBucket,
  type AnalyticsPeriod,
  type Platform,
  type PlatformSeries,
  type PublicationMetrics,
  type TopContent,
  type VariantFormat,
  type WeekSummary,
} from '@prisma-app/shared';

/**
 * Report della schermata Analytics (funzioni pure): periodi in giorni e settimane italiani,
 * serie per piattaforma e classifica dei contenuti. I valori mancanti restano null.
 */

const TIME_ZONE = 'Europe/Rome';
const DAY_MS = 86_400_000;
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export interface AccountDayRow {
  platform: Platform;
  day: string;
  followers: number | null;
  followersGained: number | null;
  followersLost: number | null;
  reach: number | null;
  views: number | null;
}

export interface PostRow {
  publicationId: number;
  contentId: number;
  title: string;
  platform: Platform;
  format: VariantFormat;
  publishedAt: Date;
  externalUrl: string | null;
  metrics: PublicationMetrics | null;
}

/** Giorno di calendario italiano (YYYY-MM-DD) di un istante. */
export function romeDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  const [, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[month! - 1]}`;
}

/** Lunedì della settimana del giorno (le settimane italiane iniziano di lunedì). */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** Intervalli del periodo, dal più vecchio: l'ultimo contiene oggi. */
export function periodBuckets(period: AnalyticsPeriod, now: Date): AnalyticsBucket[] {
  const today = romeDay(now);
  if (period === '30d') {
    return Array.from({ length: 30 }, (_, i) => {
      const start = addDays(today, i - 29);
      return { start, end: addDays(start, 1), label: dayLabel(start) };
    });
  }
  const weeks = period === '8w' ? 8 : 13;
  const current = mondayOf(today);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(current, (i - weeks + 1) * 7);
    return { start, end: addDays(start, 7), label: dayLabel(start) };
  });
}

function sum(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

const inBucket = (day: string, bucket: AnalyticsBucket) => day >= bucket.start && day < bucket.end;

/** Copertura di un post, o la misura più vicina che la piattaforma dà. */
export function postReach(metrics: PublicationMetrics | null): {
  value: number | null;
  kind: TopContent['reachKind'];
} {
  if (!metrics) return { value: null, kind: null };
  if (metrics.reach !== null) return { value: metrics.reach, kind: 'copertura' };
  if (metrics.views !== null) return { value: metrics.views, kind: 'visualizzazioni' };
  if (metrics.impressions !== null) return { value: metrics.impressions, kind: 'impressioni' };
  return { value: null, kind: null };
}

/** Da dove viene la «copertura» di ogni piattaforma, e la nota da mostrare. */
const REACH_SOURCE: Record<
  (typeof ANALYTICS_PLATFORMS)[number],
  { from: 'accountReach' | 'accountViews' | 'posts'; note: string | null }
> = {
  instagram: { from: 'accountReach', note: null },
  youtube: { from: 'accountViews', note: 'Visualizzazioni del canale' },
  tiktok: { from: 'posts', note: 'Visualizzazioni dei video pubblicati nel periodo' },
  linkedin: { from: 'posts', note: 'Impressioni inserite a mano' },
};

/** Nuovi follower: guadagnati − persi se la piattaforma li dà, altrimenti differenza dei totali. */
function followersSeries(days: AccountDayRow[], buckets: AnalyticsBucket[]): Array<number | null> {
  const hasGained = days.some((d) => d.followersGained !== null);
  if (hasGained) {
    return buckets.map((b) => {
      const inside = days.filter((d) => inBucket(d.day, b));
      const gained = sum(inside.map((d) => d.followersGained));
      if (gained === null) return null;
      return gained - (sum(inside.map((d) => d.followersLost)) ?? 0);
    });
  }
  const totals = days
    .filter((d) => d.followers !== null)
    .sort((a, b) => a.day.localeCompare(b.day));
  const lastBefore = (day: string) =>
    [...totals].reverse().find((d) => d.day < day)?.followers ?? null;
  return buckets.map((b) => {
    const insideLast = [...totals].reverse().find((d) => inBucket(d.day, b))?.followers ?? null;
    const before = lastBefore(b.start);
    return insideLast !== null && before !== null ? insideLast - before : null;
  });
}

export function platformSeries(
  platform: (typeof ANALYTICS_PLATFORMS)[number],
  days: AccountDayRow[],
  posts: PostRow[],
  buckets: AnalyticsBucket[],
): PlatformSeries {
  const ownDays = days.filter((d) => d.platform === platform);
  const ownPosts = posts.filter((p) => p.platform === platform);
  const postsIn = (b: AnalyticsBucket) =>
    ownPosts.filter((p) => inBucket(romeDay(p.publishedAt), b));
  const source = REACH_SOURCE[platform];
  const reach = buckets.map((b) => {
    if (source.from === 'posts') return sum(postsIn(b).map((p) => postReach(p.metrics).value));
    const inside = ownDays.filter((d) => inBucket(d.day, b));
    return sum(inside.map((d) => (source.from === 'accountReach' ? d.reach : d.views)));
  });
  const interactions = buckets.map((b) =>
    sum(postsIn(b).map((p) => (p.metrics ? interactionsOf(p.metrics) : null))),
  );
  return {
    platform,
    series: { reach, followers: followersSeries(ownDays, buckets), interactions },
    notes: {
      reach: source.note,
      followers: platform === 'linkedin' ? 'Non disponibili da LinkedIn' : null,
      interactions: null,
    },
  };
}

/** Contenuti del periodo per copertura (o misura equivalente), poi per interazioni. */
export function topContents(posts: PostRow[], limit = 5): TopContent[] {
  return posts
    .filter((p) => p.metrics)
    .map((p) => {
      const reach = postReach(p.metrics);
      return {
        publicationId: p.publicationId,
        contentId: p.contentId,
        title: p.title,
        platform: p.platform,
        format: p.format,
        publishedAt: p.publishedAt.toISOString(),
        externalUrl: p.externalUrl,
        reach: reach.value,
        reachKind: reach.kind,
        interactions: interactionsOf(p.metrics!),
      };
    })
    .sort(
      (a, b) =>
        (b.reach ?? -1) - (a.reach ?? -1) || (b.interactions ?? -1) - (a.interactions ?? -1),
    )
    .slice(0, limit);
}

/** Cosa misura la «copertura» di ogni piattaforma nel riepilogo della Dashboard. */
const REACH_LABELS: Record<(typeof ANALYTICS_PLATFORMS)[number], string> = {
  linkedin: 'impressioni',
  instagram: 'account raggiunti',
  tiktok: 'visualizzazioni',
  youtube: 'visualizzazioni',
};

/** Riepilogo degli ultimi 7 giorni (oggi compreso) per la Dashboard. */
export function weekSummary(
  days: AccountDayRow[],
  posts: PostRow[],
  now: Date,
): WeekSummary['platforms'] {
  const today = romeDay(now);
  const bucket = { start: addDays(today, -6), end: addDays(today, 1), label: '' };
  return (['linkedin', 'instagram', 'tiktok', 'youtube'] as const).map((platform) => {
    const series = platformSeries(platform, days, posts, [bucket]);
    const latest = days
      .filter((d) => d.platform === platform && d.followers !== null)
      .sort((a, b) => b.day.localeCompare(a.day))[0];
    return {
      platform,
      followers: latest?.followers ?? null,
      followersDelta: series.series.followers[0] ?? null,
      reach: series.series.reach[0] ?? null,
      reachLabel: REACH_LABELS[platform],
    };
  });
}
