import { describe, expect, it } from 'vitest';
import { competitorAnalysisSchema, selectAnalysisPosts, type AnalysisPost } from './analysis.js';
import { engagementBasis, interactions, median, profileStats, type StatPost } from './stats.js';
import { channelQuery, parseDuration, videoFormat } from './youtube.js';

const NOW = new Date('2026-11-27T12:00:00Z');
const daysAgo = (n: number, hourUtc = 8) => new Date(Date.UTC(2026, 10, 27 - n, hourUtc, 0, 0));

const post = (over: Partial<StatPost> = {}): StatPost => ({
  postId: 1,
  title: 'Post',
  url: 'https://example.com',
  publishedAt: daysAgo(1),
  format: 'post',
  likes: 10,
  comments: 2,
  shares: null,
  views: null,
  followers: null,
  ...over,
});

describe('statistiche dei profili', () => {
  it('mediana e interazioni note', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(interactions(post({ likes: null, comments: null }))).toBeNull();
    expect(interactions(post({ shares: 3 }))).toBe(15);
  });

  it('base del tasso: visualizzazioni se tutti i post le hanno, poi follower, mai mescolate', () => {
    expect(engagementBasis([post({ views: 100 }), post({ views: 50 })], null)).toBe(
      'visualizzazioni',
    );
    expect(engagementBasis([post({ views: 100 }), post()], 1000)).toBe('follower');
    expect(engagementBasis([post({ views: 100 }), post()], null)).toBeNull();
    expect(engagementBasis([], 1000)).toBeNull();
  });

  it('frequenza, formati, fasce e post migliori sugli ultimi 90 giorni', () => {
    const posts = [
      post({ postId: 1, publishedAt: daysAgo(14), views: 1000, likes: 50, comments: 0 }),
      post({ postId: 2, publishedAt: daysAgo(7), views: 1000, likes: 10, comments: 0 }),
      post({
        postId: 3,
        publishedAt: daysAgo(0),
        views: 100,
        likes: 20,
        comments: 0,
        format: 'short',
      }),
      // Fuori finestra: non conta.
      post({ postId: 4, publishedAt: daysAgo(120), views: 10, likes: 10 }),
    ];
    const stats = profileStats(posts, 5000, NOW);
    expect(stats.posts).toBe(3);
    expect(stats.weeks).toBe(2);
    expect(stats.postsPerWeek).toBe(1.5);
    expect(stats.basis).toBe('visualizzazioni');
    expect(stats.medianRate).toBeCloseTo(0.05);
    expect(stats.followers).toBe(5000);
    expect(stats.formats.map((f) => f.format)).toEqual(['short', 'post']);
    expect(stats.top.map((t) => t.postId)).toEqual([3, 1, 2]);
    // Tutti di venerdì alle 9 italiane: mediana dei tassi 0,05; 0,01; 0,2.
    expect(stats.slots).toEqual([{ weekday: 4, hour: 9, posts: 3, score: 0.05 }]);
  });

  it('senza base confronta le interazioni e senza post è vuoto', () => {
    const stats = profileStats([post({ likes: 5 }), post({ likes: 50, postId: 2 })], null, NOW);
    expect(stats.basis).toBeNull();
    expect(stats.medianRate).toBeNull();
    expect(stats.top[0]!.postId).toBe(2);
    expect(profileStats([], null, NOW)).toMatchObject({ posts: 0, postsPerWeek: null, weeks: 0 });
  });

  it('follower presi dal post più recente se il profilo non li ha', () => {
    const stats = profileStats(
      [post({ followers: 800, publishedAt: daysAgo(3) }), post({ followers: 900 })],
      null,
      NOW,
    );
    expect(stats.followers).toBe(900);
    expect(stats.basis).toBe('follower');
  });
});

describe('YouTube dei concorrenti', () => {
  it('handle, indirizzi e id del canale', () => {
    expect(channelQuery('fireship')).toEqual({ forHandle: '@fireship' });
    expect(channelQuery('@Fireship')).toEqual({ forHandle: '@Fireship' });
    expect(channelQuery('https://www.youtube.com/@fireship/videos')).toEqual({
      forHandle: '@fireship',
    });
    const id = 'UCsBjURrPoezykLs9EqgamOA';
    expect(channelQuery(id)).toEqual({ id });
    expect(channelQuery(`https://youtube.com/channel/${id}`)).toEqual({ id });
  });

  it('durata ISO 8601 e formato', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT45S')).toBe(45);
    expect(parseDuration('P1DT1S')).toBe(86_401);
    expect(parseDuration(undefined)).toBeNull();
    expect(videoFormat(59)).toBe('short');
    expect(videoFormat(181)).toBe('video');
    expect(videoFormat(null)).toBe('video');
  });
});

describe('analisi dei concorrenti', () => {
  const ap = (id: number, competitor: string, likes: number): AnalysisPost => ({
    ...post({ postId: id, likes }),
    postId: id,
    competitor,
    platform: 'linkedin',
    text: null,
    rate: null,
  });

  it('a turno tra i concorrenti, solo post con numeri', () => {
    const picked = selectAnalysisPosts(
      [
        [ap(1, 'A', 5), ap(2, 'A', 50), ap(3, 'A', 20)],
        [ap(4, 'B', 1), { ...ap(5, 'B', 0), likes: null, comments: null }],
      ],
      4,
    );
    expect(picked.map((p) => p.postId)).toEqual([2, 4, 3, 1]);
  });

  it('lo schema rifiuta numeri di post inesistenti', () => {
    const schema = competitorAnalysisSchema(2);
    const base = {
      summary: 's',
      hooks: [{ pattern: 'p', posts: [0] }],
      structure: 's',
      length: 'l',
      topics: [{ topic: 't', posts: [1] }],
      repeat: ['r'],
    };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.parse(base).avoid).toEqual([]);
    expect(schema.safeParse({ ...base, hooks: [{ pattern: 'p', posts: [2] }] }).success).toBe(
      false,
    );
  });
});
