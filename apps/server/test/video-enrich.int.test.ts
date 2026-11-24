import type { EnrichPlan } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createPromptLibrary } from '../src/llm/prompts.js';
import { enrichLimits, enrichPlanSchema } from '../src/modules/ai/enrich.js';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, withRollback } from './helpers/integration.js';

const SEGMENTS = [
  { startMs: 0, endMs: 3000, text: 'Oggi parliamo di Rust.' },
  { startMs: 3500, endMs: 9000, text: 'Lavoro in una sala server piena di luci.' },
  { startMs: 9500, endMs: 16_000, text: 'Uso match utente, Some e None.' },
];

const PLAN: EnrichPlan = {
  overlays: [
    { segment: 0, kind: 'title', title: 'Rust in pratica', body: '', code: '' },
    { segment: 2, kind: 'code', title: 'Il caso vuoto', body: '', code: 'match utente {}' },
  ],
  broll: [{ segment: 1, query: 'server room lights' }],
};

describe('«Aggiungi B-roll e testi» (SQLite, LLM finto)', () => {
  afterAll(closeDatabase);

  it('restituisce la proposta del modello e gli passa le frasi numerate', async () => {
    const llm = new FakeLlm();
    llm.responses.push(PLAN);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const res = await ctx.call({
          method: 'POST',
          url: '/video/enrich',
          payload: { brandId, videoTitle: 'Rust', durationMs: 16_000, segments: SEGMENTS },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(PLAN);
        expect(llm.lastPrompt()).toContain(
          '[1] 0:04–0:09 Lavoro in una sala server piena di luci.',
        );
      },
      { llm },
    );
  });

  it('rimanda al modello B-roll sulla prima frase, codice vuoto e schede doppie', () => {
    const schema = enrichPlanSchema(SEGMENTS, 16_000);
    const errors = (plan: EnrichPlan) => JSON.stringify(schema.safeParse(plan).error?.issues ?? []);
    expect(errors({ ...PLAN, broll: [{ segment: 0, query: 'face' }] })).toMatch(/frase 0/);
    expect(
      errors({
        ...PLAN,
        overlays: [{ segment: 2, kind: 'code', title: 'X', body: '', code: ' ' }],
      }),
    ).toMatch(/bisogno del codice/);
    expect(
      errors({
        ...PLAN,
        overlays: [
          { segment: 1, kind: 'title', title: 'A', body: '', code: '' },
          { segment: 1, kind: 'title', title: 'B', body: '', code: '' },
        ],
      }),
    ).toMatch(/stessa frase/);
    expect(errors({ ...PLAN, broll: [{ segment: 7, query: 'x y' }] })).toMatch(
      /Frase 7 inesistente/,
    );
    expect(enrichLimits(60_000)).toEqual({ overlays: 5, broll: 8 });
  });

  it('i prompt hanno tutte le variabili', () => {
    const prompts = createPromptLibrary();
    expect(prompts.render('video-enrich.system', { brandName: 'B', voice: 'V' })).toContain(
      'B-roll',
    );
    expect(
      prompts.render('video-enrich.user', { videoTitle: 'T', duration: '1:00', segments: 'S' }),
    ).toContain('T');
  });
});
