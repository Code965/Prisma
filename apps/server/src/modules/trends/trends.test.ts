import type { TrendItem } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { formatItems, generatedTrendsSchema, selectItems, toTrends } from './analysis.js';
import { youtubeBudget } from './service.js';
import {
  decodeEntities,
  devtoTag,
  searchDevto,
  searchGitHub,
  searchHackerNews,
  searchYouTube,
  SourceError,
  type SourceContext,
} from './sources.js';

const NOW = new Date('2026-11-27T12:00:00Z');
const SINCE = new Date('2026-11-20T12:00:00Z');

function ctxWith(responses: Record<string, unknown>, extra: Partial<SourceContext> = {}) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(responses).find((prefix) => url.startsWith(prefix));
    if (!key) return new Response('no', { status: 404 });
    const body = responses[key];
    if (typeof body === 'number') return new Response('', { status: body });
    return Response.json(body);
  }) as typeof fetch;
  return { calls, ctx: { fetch: fakeFetch, now: NOW, since: SINCE, ...extra } };
}

const item = (id: string, source: TrendItem['source'], keyword = 'rust'): TrendItem => ({
  id,
  source,
  title: `T ${id}`,
  url: `https://x/${id}`,
  author: null,
  description: null,
  publishedAt: NOW.toISOString(),
  keyword,
  signals: { points: 10 },
});

describe('fonti del radar', () => {
  it('Hacker News: storie della finestra, dalla più votata, link alla discussione senza url', async () => {
    const { ctx, calls } = ctxWith({
      'https://hn.algolia.com/api/v1/search?': {
        hits: [
          {
            objectID: '1',
            title: 'A',
            url: 'https://a',
            points: 10,
            num_comments: 2,
            created_at_i: 1795000000,
            author: 'x',
          },
          {
            objectID: '2',
            title: 'Ask HN: B',
            url: null,
            points: 90,
            num_comments: 40,
            created_at_i: 1795000000,
            author: 'y',
          },
        ],
      },
    });
    const items = await searchHackerNews('rust', ctx);
    expect(calls[0]!.url).toContain('tags=story');
    expect(decodeURIComponent(calls[0]!.url)).toContain(`created_at_i>${SINCE.getTime() / 1000}`);
    expect(items.map((i) => i.id)).toEqual(['hackernews:2', 'hackernews:1']);
    expect(items[0]).toMatchObject({
      url: 'https://news.ycombinator.com/item?id=2',
      signals: { points: 90, comments: 40 },
    });
  });

  it('GitHub: repository creati dopo l’inizio, per stelle, con gli header della doc', async () => {
    const { ctx, calls } = ctxWith({
      'https://api.github.com/search/repositories?': {
        items: [
          {
            id: 5,
            full_name: 'a/b',
            html_url: 'https://github.com/a/b',
            description: 'Desc',
            stargazers_count: 321,
            created_at: '2026-11-22T10:00:00Z',
            owner: { login: 'a' },
          },
          {
            id: 6,
            full_name: 'c/d',
            html_url: 'https://github.com/c/d',
            stargazers_count: 0,
            created_at: '2026-11-22T10:00:00Z',
          },
        ],
      },
    });
    const items = await searchGitHub('rust', ctx);
    expect(decodeURIComponent(calls[0]!.url.replace(/\+/g, ' '))).toContain(
      'q=rust created:>2026-11-20',
    );
    expect(calls[0]!.headers['X-GitHub-Api-Version']).toBe('2026-03-10');
    expect(calls[0]!.headers['User-Agent']).toMatch(/Prisma/);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'a/b', signals: { stars: 321 }, author: 'a' });
  });

  it('dev.to: tag ripulito, articoli della finestra per reazioni', async () => {
    expect(devtoTag('Node.js')).toBe('nodejs');
    expect(devtoTag('C#')).toBeNull();
    const { ctx, calls } = ctxWith({
      'https://dev.to/api/articles?': [
        {
          id: 1,
          title: 'Vecchio',
          url: 'https://dev.to/1',
          published_at: '2026-11-01T00:00:00Z',
          public_reactions_count: 999,
        },
        {
          id: 2,
          title: 'Nuovo',
          url: 'https://dev.to/2',
          published_at: '2026-11-25T00:00:00Z',
          public_reactions_count: 12,
          comments_count: 3,
          user: { name: 'Ada' },
        },
      ],
    });
    const items = await searchDevto('Node.js', ctx);
    expect(calls[0]!.url).toContain('tag=nodejs');
    expect(calls[0]!.url).toContain('top=7');
    expect(calls[0]!.headers.Accept).toBe('application/vnd.forem.api-v1+json');
    expect(items).toEqual([
      expect.objectContaining({
        id: 'devto:2',
        author: 'Ada',
        signals: { reactions: 12, comments: 3 },
      }),
    ]);
  });

  it('YouTube: ricerca per visualizzazioni e statistiche vere da videos.list', async () => {
    const { ctx, calls } = ctxWith(
      {
        'https://www.googleapis.com/youtube/v3/search?': {
          items: [
            {
              id: { videoId: 'v1' },
              snippet: {
                title: 'Rust &amp; WASM',
                channelTitle: 'Ch',
                publishedAt: '2026-11-24T00:00:00Z',
              },
            },
          ],
        },
        'https://www.googleapis.com/youtube/v3/videos?': {
          items: [
            { id: 'v1', statistics: { viewCount: '12000', likeCount: '800', commentCount: '40' } },
          ],
        },
      },
      { youtubeToken: 'tok' },
    );
    const items = await searchYouTube('rust', ctx);
    expect(calls[0]!.url).toContain('order=viewCount');
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok');
    expect(items[0]).toMatchObject({
      title: 'Rust & WASM',
      url: 'https://www.youtube.com/watch?v=v1',
      signals: { views: 12000, likes: 800, comments: 40 },
    });
    await expect(searchYouTube('rust', { ...ctx, youtubeToken: undefined })).rejects.toThrow(
      SourceError,
    );
  });

  it('errori della fonte con messaggio in italiano', async () => {
    const { ctx } = ctxWith({ 'https://api.github.com/': 403 });
    await expect(searchGitHub('rust', ctx)).rejects.toThrow(/troppe richieste/);
    expect(decodeEntities('l&#39;app')).toBe("l'app");
  });
});

describe('analisi dei trend', () => {
  const tags = [{ id: 3, brandId: 1, name: 'Tutorial' }];

  it('controlla numeri, doppioni e argomenti, poi ordina dal più promettente', () => {
    const items = [item('a', 'github'), item('b', 'devto'), item('c', 'hackernews')];
    const schema = generatedTrendsSchema(items.length, tags);
    const base = { summary: 's', why: 'w', idea: 'i', growth: 2, interest: 2, fit: 2, tag: null };
    expect(schema.safeParse({ trends: [{ ...base, title: 'x', items: [5] }] }).success).toBe(false);
    expect(
      schema.safeParse({
        trends: [
          { ...base, title: 'x', items: [0] },
          { ...base, title: 'y', items: [0] },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ trends: [{ ...base, title: 'x', items: [0], tag: 'Altro' }] }).success,
    ).toBe(false);
    const parsed = schema.parse({
      trends: [
        { ...base, title: 'basso', items: [2] },
        { ...base, title: 'alto', items: [0, 1, 1], fit: 5, tag: 'tutorial' },
      ],
    });
    const trends = toTrends(parsed, items);
    expect(trends.map((t) => t.title)).toEqual(['alto', 'basso']);
    expect(trends[0]).toMatchObject({ tagId: 3, itemIds: ['a', 'b'], scores: { fit: 5 } });
  });

  it('prompt con segnali veri e selezione a turno tra le fonti', () => {
    expect(formatItems([item('a', 'github')])).toBe('[0] GitHub · rust · "T a" · punti 10');
    const many = [
      ...Array.from({ length: 5 }, (_, i) => item(`g${i}`, 'github')),
      item('d0', 'devto'),
      item('d0', 'devto', 'go'),
    ];
    expect(selectItems(many, 3).map((i) => i.id)).toEqual(['g0', 'd0', 'g1']);
  });

  it('YouTube: al massimo 3 ricerche nelle ultime 24 ore', () => {
    const report = (requests: number) => ({
      sources: [{ source: 'youtube' as const, items: 0, requests, error: null }],
    });
    expect(youtubeBudget([])).toBe(3);
    expect(youtubeBudget([report(2)])).toBe(1);
    expect(youtubeBudget([report(2), report(2)])).toBe(0);
  });
});
