import type { Content } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createPromptLibrary } from '../src/llm/prompts.js';
import { GeneratedVideoScriptSchema, plainText } from '../src/modules/ai/video-script.js';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, withRollback } from './helpers/integration.js';

const sentence = 'Il compilatore di Rust ti ferma prima che il bug arrivi in produzione davvero.';
const SCRIPT = {
  title: 'Perché uso Rust',
  kicker: 'rust',
  scenes: [
    {
      narration: `${sentence} ${sentence}`,
      slide: { kind: 'cover', title: 'Perché uso Rust', body: 'In 45 secondi', code: '' },
    },
    {
      narration: `${sentence} ${sentence} ${sentence}`,
      slide: { kind: 'text', title: 'Il compilatore', body: 'Ti ferma prima', code: '' },
    },
    {
      narration: `${sentence} ${sentence}`,
      slide: { kind: 'cta', title: 'Seguimi', body: 'Parte due', code: '' },
    },
  ],
};

describe('«Crea video dall’idea» (SQLite, LLM finto)', () => {
  afterAll(closeDatabase);

  it('scrive il copione da un’idea', async () => {
    const llm = new FakeLlm();
    llm.responses.push(SCRIPT);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const idea = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/ideas`,
          payload: { text: 'Perché uso Rust nei miei progetti' },
        });
        const res = await ctx.call({
          method: 'POST',
          url: '/video/script',
          payload: { ideaId: idea.json<{ id: number }>().id },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ brandId, title: 'Perché uso Rust', kicker: 'rust' });
        expect(res.json().scenes).toHaveLength(3);
        expect(llm.lastPrompt()).toContain('Perché uso Rust nei miei progetti');
      },
      { llm },
    );
  });

  it('scrive il copione dal testo di una bozza', async () => {
    const llm = new FakeLlm();
    llm.responses.push(SCRIPT);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const content = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/contents`,
            payload: { title: 'Rust', platforms: ['linkedin'] },
          })
        ).json<Content>();
        const variant = content.variants[0]!;
        await ctx.call({
          method: 'PATCH',
          url: `/variants/${variant.id}`,
          payload: {
            body: 'Testo del post su Rust',
            metadata: variant.metadata,
            expectedVersion: variant.version,
          },
        });
        const res = await ctx.call({
          method: 'POST',
          url: '/video/script',
          payload: { variantId: variant.id },
        });
        expect(res.statusCode).toBe(200);
        expect(llm.lastPrompt()).toContain('Testo del post su Rust');
        expect(llm.lastPrompt()).toContain('«Rust»');
      },
      { llm },
    );
  });

  it('senza AI configurata risponde 503', async () => {
    await withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const idea = await ctx.call({
        method: 'POST',
        url: `/brands/${brandId}/ideas`,
        payload: { text: 'x' },
      });
      const res = await ctx.call({
        method: 'POST',
        url: '/video/script',
        payload: { ideaId: idea.json<{ id: number }>().id },
      });
      expect(res.statusCode).toBe(503);
    });
  });

  it('rimanda al modello una narrazione troppo corta', () => {
    const short = { ...SCRIPT, scenes: SCRIPT.scenes.map((s) => ({ ...s, narration: 'Ciao.' })) };
    const result = GeneratedVideoScriptSchema.safeParse(short);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/3 parole/);
  });

  it('ricava il testo semplice da un articolo HTML', () => {
    expect(plainText('<h2>Titolo</h2><p>Uno &amp; <strong>due</strong></p>')).toBe(
      'Titolo\nUno & due',
    );
  });

  it('i prompt hanno tutte le variabili', () => {
    const prompts = createPromptLibrary();
    const system = prompts.render('generate-video-script.system', {
      brandName: 'B',
      voice: 'V',
      targetSeconds: '45',
      minScenes: '3',
      maxScenes: '8',
      minWords: '70',
      maxWords: '160',
      targetWords: '108',
    });
    expect(system).toContain('45 secondi');
    expect(
      prompts.render('generate-video-script.user', { sourceLabel: 'Idea', text: 'T' }),
    ).toContain('Idea');
  });
});
