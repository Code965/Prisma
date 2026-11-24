import type { AutoEditPlan } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { autoEditPlanSchema } from '../src/modules/ai/auto-edit.js';
import { createPromptLibrary } from '../src/llm/prompts.js';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, withRollback } from './helpers/integration.js';

const SEGMENTS = [
  { startMs: 0, endMs: 2300, text: 'Allora, no aspetta.' },
  { startMs: 2600, endMs: 6000, text: 'Oggi vi spiego perché uso Rust.' },
  { startMs: 6400, endMs: 9000, text: 'Cioè, Rust è velocissimo.' },
];

const PLAN: AutoEditPlan = {
  removeSegments: [{ segment: 0, reason: 'falsa partenza' }],
  fillers: [{ segment: 2, words: ['Cioè'] }],
  keywords: [{ segment: 2, words: ['velocissimo'] }],
  emphasis: [1],
  hook: { text: 'Perché uso Rust', segment: 1 },
};

describe('«Monta con l’AI» (SQLite, LLM finto)', () => {
  afterAll(closeDatabase);

  it('restituisce la proposta del modello e gli passa le frasi numerate', async () => {
    const llm = new FakeLlm();
    llm.responses.push(PLAN);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const res = await ctx.call({
          method: 'POST',
          url: '/video/auto-edit',
          payload: { brandId, videoTitle: 'Perché Rust', durationMs: 9000, segments: SEGMENTS },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(PLAN);
        expect(llm.lastPrompt()).toContain('[2] 0:06–0:09 Cioè, Rust è velocissimo.');
      },
      { llm },
    );
  });

  it('senza AI configurata risponde 503', async () => {
    await withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const res = await ctx.call({
        method: 'POST',
        url: '/video/auto-edit',
        payload: { brandId, videoTitle: 'x', durationMs: 9000, segments: SEGMENTS },
      });
      expect(res.statusCode).toBe(503);
    });
  });

  it('rimanda al modello numeri di frase inesistenti e tagli eccessivi', () => {
    const schema = autoEditPlanSchema(SEGMENTS);
    const bad = schema.safeParse({ ...PLAN, emphasis: [7] });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toMatch(/Frase 7 inesistente/);
    const tooMany = schema.safeParse({
      ...PLAN,
      removeSegments: [
        { segment: 0, reason: 'a' },
        { segment: 1, reason: 'b' },
      ],
    });
    expect(tooMany.success).toBe(false);
  });

  it('il prompt ha tutte le variabili che il codice fornisce', () => {
    const prompts = createPromptLibrary();
    expect(
      prompts.render('video-auto-edit.system', { brandName: 'B', voice: 'V', hookMaxChars: '60' }),
    ).toMatch(/json/);
    expect(
      prompts.render('video-auto-edit.user', { videoTitle: 'T', duration: '1:00', segments: 'S' }),
    ).toContain('T');
  });
});
