import type { Competitor, CompetitorAnalysis, CompetitorsState } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, NOW, withRollback } from './helpers/integration.js';

const CHANNEL = 'UCabcdefghijklmnopqrstuv';
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** YouTube finto: canale con due video; conta le chiamate. */
function fakeYouTube() {
  const calls: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fetchFn = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname.split('/').pop()!);
    if (url.pathname.endsWith('/channels')) {
      if (url.searchParams.get('forHandle') === '@nessuno') return json({ items: [] });
      return json({
        items: [
          {
            id: CHANNEL,
            snippet: { title: 'Canale Tech', customUrl: '@canaletech' },
            statistics: { subscriberCount: '12000', hiddenSubscriberCount: false },
            contentDetails: { relatedPlaylists: { uploads: 'UUabc' } },
          },
        ],
      });
    }
    if (url.pathname.endsWith('/playlistItems')) {
      return json({
        items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }],
      });
    }
    return json({
      items: [
        {
          id: 'v1',
          snippet: { title: 'Rust in 100 secondi &amp; altro', publishedAt: day(3) },
          statistics: { viewCount: '10000', likeCount: '900', commentCount: '100' },
          contentDetails: { duration: 'PT58S' },
        },
        {
          id: 'v2',
          snippet: { title: 'Corso completo', description: 'Tutto', publishedAt: day(10) },
          statistics: { viewCount: '5000', likeCount: '100' },
          contentDetails: { duration: 'PT25M' },
        },
      ],
    });
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

describe('concorrenti', () => {
  afterAll(closeDatabase);

  it("canale YouTube, post a mano, statistiche e analisi dell'AI", async () => {
    const llm = new FakeLlm();
    const yt = fakeYouTube();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        await ctx.createAccount(brandId, 'youtube');

        const missing = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/competitors`,
          payload: { name: 'X', platform: 'youtube', handle: 'nessuno' },
        });
        expect(missing.statusCode).toBe(422);

        const created = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/competitors`,
          payload: { name: 'Canale Tech', platform: 'youtube', handle: '@canaletech' },
        });
        expect(created.statusCode).toBe(201);
        const channel = created.json<Competitor>();
        expect(channel).toMatchObject({
          externalId: CHANNEL,
          followers: 12000,
          lastError: null,
          url: `https://www.youtube.com/channel/${CHANNEL}`,
        });
        expect(channel.posts.map((p) => [p.title, p.format, p.source])).toEqual([
          ['Rust in 100 secondi & altro', 'short', 'api'],
          ['Corso completo', 'video', 'api'],
        ]);
        expect(channel.stats).toMatchObject({ posts: 2, basis: 'visualizzazioni' });
        expect(channel.stats.top[0]!.rate).toBeCloseTo(0.1);

        const dup = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/competitors`,
          payload: { name: 'Doppio', platform: 'youtube', handle: 'canaletech' },
        });
        expect(dup.statusCode).toBe(422);

        // Subito dopo l'aggiunta «Aggiorna» è rifiutato.
        expect(
          (await ctx.call({ method: 'POST', url: `/competitors/${channel.id}/refresh` }))
            .statusCode,
        ).toBe(422);

        const linkedin = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/competitors`,
            payload: { name: 'Marta', platform: 'linkedin', handle: 'marta-dev' },
          })
        ).json<Competitor>();
        const bad = await ctx.call({
          method: 'POST',
          url: `/competitors/${linkedin.id}/posts`,
          payload: { url: 'ftp://x', publishedAt: day(1), format: 'post' },
        });
        expect(bad.statusCode).toBe(400);
        const manual = await ctx.call({
          method: 'POST',
          url: `/competitors/${linkedin.id}/posts`,
          payload: {
            text: 'Tre errori che faccio con TypeScript',
            url: 'https://www.linkedin.com/posts/marta-1',
            publishedAt: day(2),
            format: 'carosello',
            likes: 120,
            comments: 30,
            followers: 5000,
          },
        });
        expect(manual.statusCode).toBe(201);

        let state = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/competitors` })
        ).json<CompetitorsState>();
        expect(state.competitors).toHaveLength(2);
        expect(state.competitors[1]).toMatchObject({
          followers: 5000,
          stats: { basis: 'follower', medianRate: 0.03 },
        });
        expect(state.analysisBlocked).toBeNull();
        expect(state.own).toEqual([]);

        llm.responses.push({
          summary: 'Aperture concrete.',
          hooks: [{ pattern: 'Numero nel titolo', posts: [0, 2] }],
          structure: 'Problema e soluzione.',
          length: 'Brevi.',
          topics: [{ topic: 'Rust', posts: [0] }],
          repeat: ['Titoli con un risultato'],
        });
        const analyzed = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/competitors/analysis`,
        });
        expect(analyzed.statusCode).toBe(201);
        const analysis = analyzed.json<CompetitorAnalysis>();
        const prompt = llm.lastPrompt();
        expect(prompt).toContain(
          '[0] Canale Tech · YouTube · short · titolo: "Rust in 100 secondi & altro"',
        );
        expect(prompt).toContain('tasso di interazione 10.0%');
        expect(prompt).toContain('[1] Marta · LinkedIn · carosello');
        expect(analysis).toMatchObject({ basedOn: 3, model: 'fake', avoid: [] });
        expect(analysis.hooks[0]!.postIds).toHaveLength(2);

        state = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/competitors` })
        ).json<CompetitorsState>();
        expect(state.analysis?.summary).toBe('Aperture concrete.');

        // I post di YouTube non si cancellano a mano, quelli manuali sì.
        const apiPost = state.competitors[0]!.posts[0]!;
        expect(
          (await ctx.call({ method: 'DELETE', url: `/competitor-posts/${apiPost.id}` })).statusCode,
        ).toBe(422);
        const manualPost = state.competitors[1]!.posts[0]!;
        expect(
          (await ctx.call({ method: 'DELETE', url: `/competitor-posts/${manualPost.id}` }))
            .statusCode,
        ).toBe(204);
        expect(
          (await ctx.call({ method: 'DELETE', url: `/competitors/${channel.id}` })).statusCode,
        ).toBe(204);
        expect(yt.calls).toEqual(['channels', 'channels', 'channels', 'playlistItems', 'videos']);
      },
      { llm, competitors: { fetch: yt.fetch }, accessToken: async () => 'token' },
    );
  });

  it('senza account YouTube il canale si salva con un avviso e senza chiamate', async () => {
    const yt = fakeYouTube();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const created = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/competitors`,
            payload: { name: 'Canale', platform: 'youtube', handle: '@canale' },
          })
        ).json<Competitor>();
        expect(created.lastError).toMatch(/Collega un account YouTube/);
        expect(yt.calls).toEqual([]);
        const state = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/competitors` })
        ).json<CompetitorsState>();
        expect(state.analysisBlocked).toMatch(/AI non configurata/);
      },
      { competitors: { fetch: yt.fetch }, accessToken: async () => 'token' },
    );
  });
});
