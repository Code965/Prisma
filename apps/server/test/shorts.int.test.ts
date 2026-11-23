import type { GenerateShortsResult, VariantRevision } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, databaseUrl, withRollback } from './helpers/integration.js';

const segments = [
  { startMs: 0, endMs: 5_000, text: 'Ciao a tutti, oggi parliamo di database.' },
  { startMs: 5_000, endMs: 20_000, text: 'Una query impiegava trenta secondi.' },
  { startMs: 20_000, endMs: 32_000, text: 'Con un indice composto è scesa a venti millisecondi.' },
  { startMs: 32_000, endMs: 60_000, text: 'Poi ho riscritto il client in Avalonia.' },
];

describe.skipIf(!databaseUrl)('Genera Short (MySQL, LLM finto)', () => {
  afterAll(closeDatabase);

  it('crea un contenuto in bozza per momento, con i formati verticali', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        llm.responses.push({
          shorts: [
            {
              firstSegment: 1,
              lastSegment: 2,
              title: 'Da 30 secondi a 20 ms',
              reason: 'Problema e soluzione in un colpo',
              variants: [
                {
                  platform: 'youtube',
                  body: 'Un indice e via.',
                  title: 'Query 1500 volte più veloce',
                  hashtags: ['mysql'],
                },
                { platform: 'tiktok', body: 'Da 30 s a 20 ms', hashtags: ['#sql'] },
                { platform: 'instagram', body: 'Salva per dopo', hashtags: [] },
              ],
            },
          ],
        });
        const res = await ctx.call({
          method: 'POST',
          url: '/shorts/generate',
          payload: {
            brandId,
            videoTitle: 'Client database',
            durationMs: 60_000,
            segments,
            platforms: ['youtube', 'tiktok', 'instagram'],
          },
        });
        expect(res.statusCode).toBe(201);
        const { shorts } = res.json<GenerateShortsResult>();
        expect(shorts).toHaveLength(1);
        const [short] = shorts;
        expect(short).toMatchObject({
          startMs: 5_000,
          endMs: 32_000,
          reason: 'Problema e soluzione in un colpo',
        });
        expect(short!.content.title).toBe('Da 30 secondi a 20 ms');
        const formats = Object.fromEntries(
          short!.content.variants.map((v) => [v.platform, [v.format, v.status]]),
        );
        expect(formats).toEqual({
          youtube: ['short', 'bozza'],
          tiktok: ['video', 'bozza'],
          instagram: ['reel', 'bozza'],
        });
        const youtube = short!.content.variants.find((v) => v.platform === 'youtube')!;
        expect(youtube.metadata).toMatchObject({
          title: 'Query 1500 volte più veloce',
          hashtags: ['#mysql'],
        });
        expect(llm.lastPrompt()).toContain('[2] 0:20–0:32 Con un indice composto');
        const revisions = (
          await ctx.call({ method: 'GET', url: `/variants/${youtube.id}/revisions` })
        ).json<VariantRevision[]>();
        expect(revisions[0]!.source).toBe('llm_generate');
      },
      { llm },
    );
  });

  it('senza LLM risponde 503 e valida la richiesta', async () => {
    await withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const payload = {
        brandId,
        videoTitle: 'V',
        durationMs: 60_000,
        segments,
        platforms: ['youtube'],
      };
      expect(
        (await ctx.call({ method: 'POST', url: '/shorts/generate', payload })).statusCode,
      ).toBe(503);
      const bad = await ctx.call({
        method: 'POST',
        url: '/shorts/generate',
        payload: { ...payload, platforms: ['linkedin'] },
      });
      expect(bad.statusCode).toBe(400);
    });
  });
});
