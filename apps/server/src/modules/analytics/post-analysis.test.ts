import type { PublicationMetrics } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  analyzePosts,
  dayPart,
  lengthBand,
  openingKind,
  openingOf,
  wordCount,
  type OwnPost,
} from './post-analysis.js';
import { formatGroups, postAnalysisSchema, selectAiPosts } from './post-analysis-service.js';

const NOW = new Date('2026-11-27T12:00:00Z');
// 8:00 UTC = 9:00 a Roma (mattina).
const daysAgo = (n: number, hourUtc = 8) => new Date(Date.UTC(2026, 10, 27 - n, hourUtc, 0, 0));

const metrics = (over: Partial<PublicationMetrics> = {}): PublicationMetrics => ({
  publicationId: 1,
  capturedAt: NOW.toISOString(),
  impressions: null,
  reach: null,
  views: null,
  likes: 10,
  comments: 2,
  shares: null,
  saves: null,
  source: 'api',
  ...over,
});

let nextId = 1;
const post = (over: Partial<OwnPost> = {}): OwnPost => ({
  publicationId: nextId++,
  platform: 'linkedin',
  title: 'Post',
  url: 'https://www.linkedin.com/feed/update/1',
  publishedAt: daysAgo(1),
  format: 'post',
  body: 'Una frase. Poi il resto.',
  heading: null,
  tags: [],
  metrics: metrics(),
  ...over,
});

describe('analisi dei propri post', () => {
  it('testo: parole senza hashtag, prima frase, tipo di apertura, fasce', () => {
    expect(wordCount('Ciao a tutti\n#rust #dev')).toBe(3);
    expect(openingOf('\n  Perché Rust? Te lo spiego.\nAltro', null)).toBe('Perché Rust?');
    expect(openingOf('Testo', '  Titolo del video  ')).toBe('Titolo del video');
    expect(openingOf('a'.repeat(200), null)).toHaveLength(140);
    expect(openingKind('Perché Rust?')).toBe('Domanda');
    expect(openingKind('5 errori con Docker')).toBe('Numero o elenco');
    expect(openingKind('Come ho dimezzato i tempi')).toBe('Come fare / perché');
    expect(openingKind('Ieri ho rotto la produzione.')).toBe('Esperienza personale');
    expect(openingKind('Il codice pulito è sopravvalutato.')).toBe('Affermazione');
    expect(openingKind('')).toBe('Senza testo');
    expect(lengthBand(49).key).toBe('breve');
    expect(lengthBand(150).key).toBe('lunga');
    expect(lengthBand(1000).key).toBe('molto-lunga');
    expect(dayPart(5).key).toBe('notte');
    expect(dayPart(18).key).toBe('sera');
  });

  it('tasso sulle visualizzazioni, gruppi per dimensione e «pochi dati» in fondo', () => {
    const posts = [
      post({ tags: ['Rust'], metrics: metrics({ views: 100, likes: 10, comments: 0 }) }),
      post({ tags: ['Rust', 'AI'], metrics: metrics({ views: 100, likes: 20, comments: 0 }) }),
      post({
        tags: ['AI'],
        format: 'carosello',
        body: 'Come usare gli agenti?',
        metrics: metrics({ views: 100, likes: 2, comments: 0 }),
      }),
      post({ metrics: null }),
      // Fuori dalla finestra di 90 giorni.
      post({ publishedAt: daysAgo(120) }),
    ];
    const [li] = analyzePosts(posts, {}, NOW);
    expect(li).toMatchObject({
      platform: 'linkedin',
      published: 4,
      measured: 3,
      basis: 'visualizzazioni',
      medianRate: 0.1,
    });
    const topics = li!.dimensions.find((d) => d.dimension === 'argomento')!.groups;
    expect(topics.map((g) => [g.label, g.posts, g.medianRate, g.fewData])).toEqual([
      ['Rust', 2, 0.15000000000000002, false],
      ['AI', 2, 0.11, false],
    ]);
    const formats = li!.dimensions.find((d) => d.dimension === 'formato')!.groups;
    expect(formats.map((g) => [g.label, g.fewData])).toEqual([
      ['Post', false],
      ['Carosello', true],
    ]);
    const parts = li!.dimensions.find((d) => d.dimension === 'fascia')!.groups;
    expect(parts[0]).toMatchObject({ label: 'Mattina (6–12)', posts: 3 });
    // Il post senza metriche resta nell'elenco ma non nei gruppi.
    expect(li!.posts).toHaveLength(4);
    expect(li!.posts.find((p) => p.interactions === null)).toBeTruthy();
  });

  it('senza visualizzazioni usa i follower; senza nulla solo le interazioni', () => {
    const posts = [post({ platform: 'instagram' }), post({ platform: 'tiktok' })];
    const result = analyzePosts(posts, { instagram: 1000 }, NOW);
    expect(result.find((p) => p.platform === 'instagram')).toMatchObject({
      basis: 'follower',
      medianRate: 0.012,
    });
    expect(result.find((p) => p.platform === 'tiktok')).toMatchObject({
      basis: null,
      medianRate: null,
      medianInteractions: 12,
    });
  });

  it('le aperture classificate dall’AI sostituiscono quelle delle regole', () => {
    const a = post({ body: 'Domanda?' });
    const [li] = analyzePosts([a], {}, NOW, new Map([[a.publicationId, 'Errore comune']]));
    expect(li!.posts[0]!.openingKind).toBe('Errore comune');
  });

  it('per l’AI: post misurati dal migliore, gruppi senza le aperture, schema con ogni post una volta', () => {
    const platforms = analyzePosts(
      [
        post({ metrics: metrics({ views: 100, likes: 1 }) }),
        post({ metrics: metrics({ views: 100, likes: 50 }) }),
        post({ metrics: null }),
      ],
      {},
      NOW,
    );
    const selected = selectAiPosts(platforms);
    expect(selected.map((p) => p.interactions)).toEqual([52, 3]);
    const groups = formatGroups(platforms);
    expect(groups).toContain('LinkedIn · 2 post misurati · tasso su visualizzazioni');
    expect(groups).not.toContain('Apertura');

    const schema = postAnalysisSchema(2);
    const conclusions = [{ text: 'a', posts: [0] }, { text: 'b' }, { text: 'c', posts: [] }];
    expect(
      schema.safeParse({ openings: [{ label: 'X', posts: [0, 1] }], conclusions }).success,
    ).toBe(true);
    expect(schema.safeParse({ openings: [{ label: 'X', posts: [0] }], conclusions }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ openings: [{ label: 'X', posts: [0, 1, 2] }], conclusions }).success,
    ).toBe(false);
  });
});
