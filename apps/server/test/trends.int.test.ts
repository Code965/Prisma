import type { TrendItem, TrendReport, TrendsState } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { SourceSearch } from '../src/modules/trends/sources.js';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, NOW, withRollback } from './helpers/integration.js';

const found = (source: TrendItem['source'], id: string, keyword: string): TrendItem => ({
  id: `${source}:${id}`,
  source,
  title: `Titolo ${id}`,
  url: `https://example.com/${id}`,
  author: 'autore',
  description: null,
  publishedAt: NOW.toISOString(),
  keyword,
  signals: source === 'github' ? { stars: 120 } : { points: 45, comments: 9 },
});

/** Fonti finte che contano le chiamate; dev.to fallisce. */
function fakeSources() {
  const calls: string[] = [];
  const make =
    (source: TrendItem['source']): SourceSearch =>
    async (keyword) => {
      calls.push(`${source}:${keyword}`);
      if (source === 'devto')
        throw new (await import('../src/modules/trends/sources.js')).SourceError(
          'dev.to ha risposto 500',
        );
      return [found(source, `${keyword}-1`, keyword)];
    };
  return {
    calls,
    searches: {
      hackernews: make('hackernews'),
      github: make('github'),
      devto: make('devto'),
      youtube: make('youtube'),
    },
  };
}

describe('radar dei trend', () => {
  afterAll(closeDatabase);

  it('parole del radar, aggiornamento con AI, limiti e stato', async () => {
    const llm = new FakeLlm();
    const sources = fakeSources();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const tag = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/tags`,
            payload: { name: 'Tutorial' },
          })
        ).json<{ id: number }>();

        const empty = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/trends` })
        ).json<TrendsState>();
        expect(empty).toMatchObject({
          keywords: [],
          report: null,
          blocked: expect.stringMatching(/parola/),
        });
        expect(
          (await ctx.call({ method: 'POST', url: `/brands/${brandId}/trends` })).statusCode,
        ).toBe(422);

        const bad = await ctx.call({
          method: 'PUT',
          url: `/brands/${brandId}/trends/keywords`,
          payload: { keywords: ['rust', 'Rust'] },
        });
        expect(bad.statusCode).toBe(400);
        await ctx.call({
          method: 'PUT',
          url: `/brands/${brandId}/trends/keywords`,
          payload: { keywords: ['rust', 'typescript'] },
        });

        llm.responses.push({
          trends: [
            {
              title: 'Rust nei tool',
              summary: 'Nuovi strumenti in Rust.',
              why: 'Adatto ai tutorial.',
              growth: 4,
              interest: 3,
              fit: 5,
              tag: 'Tutorial',
              idea: 'Tre tool in Rust che uso ogni giorno',
              items: [0, 1],
            },
          ],
        });
        const created = await ctx.call({ method: 'POST', url: `/brands/${brandId}/trends` });
        expect(created.statusCode).toBe(201);
        const report = created.json<TrendReport>();
        expect(report.trends).toEqual([
          expect.objectContaining({
            title: 'Rust nei tool',
            tagId: tag.id,
            scores: { growth: 4, interest: 3, fit: 5 },
          }),
        ]);
        expect(report.items).toHaveLength(2);
        expect(report.sources).toEqual([
          { source: 'hackernews', items: 2, requests: 2, error: null },
          { source: 'github', items: 2, requests: 2, error: null },
          { source: 'devto', items: 0, requests: 0, error: 'dev.to ha risposto 500' },
          { source: 'youtube', items: 0, requests: 0, error: 'Collega un account YouTube' },
        ]);
        // Nessuna chiamata a YouTube senza account collegato.
        expect(sources.calls.filter((c) => c.startsWith('youtube'))).toEqual([]);
        expect(llm.lastPrompt()).toContain(
          '[0] Hacker News · rust · "Titolo rust-1" · punti 45, commenti 9',
        );
        expect(llm.lastPrompt()).toContain('Argomenti del brand: Tutorial');

        // Subito dopo «Aggiorna» è rifiutato per 15 minuti.
        const again = await ctx.call({ method: 'POST', url: `/brands/${brandId}/trends` });
        expect(again.statusCode).toBe(422);
        expect(again.json().message).toMatch(/riprova tra 15 minuti/);

        const state = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/trends` })
        ).json<TrendsState>();
        expect(state).toMatchObject({
          keywords: ['rust', 'typescript'],
          blocked: null,
          report: { id: report.id, model: 'fake' },
          nextRefreshAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
        });
      },
      { llm, trends: { searches: sources.searches } },
    );
  });

  it('senza AI configurata il radar è bloccato', async () => {
    await withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const state = (
        await ctx.call({ method: 'GET', url: `/brands/${brandId}/trends` })
      ).json<TrendsState>();
      expect(state.blocked).toMatch(/AI non configurata/);
      expect(
        (await ctx.call({ method: 'POST', url: `/brands/${brandId}/trends` })).statusCode,
      ).toBe(503);
    });
  });
});
