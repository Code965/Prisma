import type { TrendItem, TrendSource } from '@prisma-app/shared';

/**
 * Fonti del radar dei trend (fase 8a). Solo API pubbliche documentate, niente scraping; i
 * segnali sono quelli restituiti dalla fonte. Verifiche sulla documentazione in CLAUDE.md.
 */

export interface SourceContext {
  fetch: typeof fetch;
  now: Date;
  /** Inizio della finestra (contenuti pubblicati dopo). */
  since: Date;
  /** Token OAuth di YouTube (solo per la fonte youtube). */
  youtubeToken?: string;
}

export type SourceSearch = (keyword: string, ctx: SourceContext) => Promise<TrendItem[]>;

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** Contenuti tenuti per fonte e parola (i più popolari). */
export const ITEMS_PER_SEARCH = 6;
const USER_AGENT = 'Prisma-trend-radar (+https://github.com/Code965/Prisma)';

async function getJson<T>(
  ctx: SourceContext,
  url: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await ctx.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SourceError(`${label} non raggiungibile`);
  }
  if (response.status === 429 || response.status === 403) {
    throw new SourceError(`${label}: troppe richieste, riprova più tardi`);
  }
  if (!response.ok) throw new SourceError(`${label} ha risposto ${response.status}`);
  return (await response.json()) as T;
}

const nonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

const clip = (text: string | null | undefined, max: number): string | null => {
  const value = text?.replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

// --- Hacker News (Algolia) -------------------------------------------------------------------

interface HnHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at_i?: number;
}

export const searchHackerNews: SourceSearch = async (keyword, ctx) => {
  const params = new URLSearchParams({
    query: keyword,
    tags: 'story',
    numericFilters: `created_at_i>${Math.floor(ctx.since.getTime() / 1000)},points>5`,
    hitsPerPage: '30',
  });
  const body = await getJson<{ hits?: HnHit[] }>(
    ctx,
    `https://hn.algolia.com/api/v1/search?${params}`,
    'Hacker News',
  );
  return (body.hits ?? [])
    .filter((hit) => hit.title && hit.created_at_i)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, ITEMS_PER_SEARCH)
    .map((hit) => ({
      id: `hackernews:${hit.objectID}`,
      source: 'hackernews' as const,
      title: clip(hit.title, 200)!,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author ?? null,
      description: null,
      publishedAt: new Date(hit.created_at_i! * 1000).toISOString(),
      keyword,
      signals: compact({
        points: nonNegative(hit.points),
        comments: nonNegative(hit.num_comments),
      }),
    }));
};

// --- GitHub (ricerca dei repository) ---------------------------------------------------------

interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  created_at: string;
  owner?: { login?: string };
}

export const searchGitHub: SourceSearch = async (keyword, ctx) => {
  const day = ctx.since.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: `${keyword} created:>${day}`,
    sort: 'stars',
    order: 'desc',
    per_page: String(ITEMS_PER_SEARCH),
  });
  const body = await getJson<{ items?: GitHubRepo[] }>(
    ctx,
    `https://api.github.com/search/repositories?${params}`,
    'GitHub',
    { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
  );
  return (body.items ?? [])
    .filter((repo) => (repo.stargazers_count ?? 0) > 0)
    .map((repo) => ({
      id: `github:${repo.id}`,
      source: 'github' as const,
      title: repo.full_name,
      url: repo.html_url,
      author: repo.owner?.login ?? null,
      description: clip(repo.description, 240),
      publishedAt: new Date(repo.created_at).toISOString(),
      keyword,
      signals: compact({ stars: nonNegative(repo.stargazers_count) }),
    }));
};

// --- dev.to (Forem API) ----------------------------------------------------------------------

interface DevtoArticle {
  id: number;
  title: string;
  url: string;
  description?: string | null;
  published_at?: string;
  public_reactions_count?: number;
  comments_count?: number;
  user?: { name?: string };
}

/** I tag di dev.to sono solo lettere e numeri minuscoli. */
export function devtoTag(keyword: string): string | null {
  const tag = keyword
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
  return tag.length >= 2 ? tag : null;
}

export const searchDevto: SourceSearch = async (keyword, ctx) => {
  const tag = devtoTag(keyword);
  if (!tag) return [];
  const days = Math.max(1, Math.ceil((ctx.now.getTime() - ctx.since.getTime()) / 86_400_000));
  const params = new URLSearchParams({ tag, top: String(days), per_page: '30' });
  const body = await getJson<DevtoArticle[]>(
    ctx,
    `https://dev.to/api/articles?${params}`,
    'dev.to',
    { Accept: 'application/vnd.forem.api-v1+json' },
  );
  return (Array.isArray(body) ? body : [])
    .filter((a) => a.published_at && new Date(a.published_at) >= ctx.since)
    .sort((a, b) => (b.public_reactions_count ?? 0) - (a.public_reactions_count ?? 0))
    .slice(0, ITEMS_PER_SEARCH)
    .map((a) => ({
      id: `devto:${a.id}`,
      source: 'devto' as const,
      title: clip(a.title, 200)!,
      url: a.url,
      author: a.user?.name ?? null,
      description: clip(a.description, 240),
      publishedAt: new Date(a.published_at!).toISOString(),
      keyword,
      signals: compact({
        reactions: nonNegative(a.public_reactions_count),
        comments: nonNegative(a.comments_count),
      }),
    }));
};

// --- YouTube (search.list + videos.list) -----------------------------------------------------

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; description?: string; publishedAt?: string };
}

interface YouTubeVideoStats {
  id: string;
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

const count = (value: string | undefined) =>
  value === undefined ? undefined : nonNegative(Number(value));

/**
 * search.list costa 1 unità ma ha un limite a parte di 100 chiamate al giorno per progetto;
 * videos.list 1 unità della quota generale. Una ricerca per parola, al massimo 3 al giorno.
 */
export const searchYouTube: SourceSearch = async (keyword, ctx) => {
  if (!ctx.youtubeToken) throw new SourceError('Collega un account YouTube');
  const auth = { Authorization: `Bearer ${ctx.youtubeToken}` };
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'viewCount',
    q: keyword,
    publishedAfter: ctx.since.toISOString(),
    maxResults: String(ITEMS_PER_SEARCH),
  });
  const search = await getJson<{ items?: YouTubeSearchItem[] }>(
    ctx,
    `https://www.googleapis.com/youtube/v3/search?${params}`,
    'YouTube',
    auth,
  );
  const found = (search.items ?? []).filter((item) => item.id?.videoId && item.snippet?.title);
  if (found.length === 0) return [];
  const stats = await getJson<{ items?: YouTubeVideoStats[] }>(
    ctx,
    `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
      part: 'statistics',
      id: found.map((item) => item.id!.videoId!).join(','),
    })}`,
    'YouTube',
    auth,
  );
  const byId = new Map((stats.items ?? []).map((video) => [video.id, video.statistics ?? {}]));
  return found.map((item) => {
    const videoId = item.id!.videoId!;
    const s = byId.get(videoId) ?? {};
    return {
      id: `youtube:${videoId}`,
      source: 'youtube' as const,
      title: clip(decodeEntities(item.snippet!.title!), 200)!,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: item.snippet!.channelTitle ?? null,
      description: clip(decodeEntities(item.snippet!.description ?? ''), 240),
      publishedAt: new Date(item.snippet!.publishedAt ?? ctx.since).toISOString(),
      keyword,
      signals: compact({
        views: count(s.viewCount),
        likes: count(s.likeCount),
        comments: count(s.commentCount),
      }),
    };
  });
};

/** I titoli di search.list arrivano con le entità HTML («&#39;», «&amp;»). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export const SOURCE_SEARCHES: Record<TrendSource, SourceSearch> = {
  hackernews: searchHackerNews,
  github: searchGitHub,
  devto: searchDevto,
  youtube: searchYouTube,
};
