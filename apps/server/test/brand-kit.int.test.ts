import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_KIT, type BrandKit, type Idea, type VoiceExample } from '@prisma-app/shared';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, databaseUrl, withRollback } from './helpers/integration.js';

describe.skipIf(!databaseUrl)('brand kit e voce (MySQL)', () => {
  afterAll(closeDatabase);

  it('restituisce i valori predefiniti e salva il kit', async () => {
    await withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const initial = await ctx.call({ method: 'GET', url: `/brands/${brandId}/kit` });
      expect(initial.json()).toEqual(DEFAULT_BRAND_KIT);

      const saved = await ctx.call({
        method: 'PUT',
        url: `/brands/${brandId}/kit`,
        payload: {
          ...DEFAULT_BRAND_KIT,
          colors: { ...DEFAULT_BRAND_KIT.colors, accent: '#16a34a' },
          handle: '@marta',
          voiceRules: ['Frasi brevi'],
        },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json<BrandKit>()).toMatchObject({
        colors: { accent: '#16A34A' },
        handle: 'marta',
        voiceRules: ['Frasi brevi'],
      });

      const invalid = await ctx.call({
        method: 'PUT',
        url: `/brands/${brandId}/kit`,
        payload: { ...DEFAULT_BRAND_KIT, logo: 'data:text/html;base64,PGI+' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(await ctx.call({ method: 'GET', url: '/brands/999999/kit' })).toMatchObject({
        statusCode: 404,
      });
    });
  });

  it('aggiunge e rimuove esempi, e la voce entra nel prompt di generazione', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        await ctx.call({
          method: 'PUT',
          url: `/brands/${brandId}/kit`,
          payload: { ...DEFAULT_BRAND_KIT, voiceRules: ['Niente emoji'] },
        });
        const added = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/voice-examples`,
          payload: {
            platform: 'instagram',
            text: 'Una settimana bloccato. La soluzione era una riga.',
            note: 'chiusura',
          },
        });
        expect(added.statusCode).toBe(201);
        const example = added.json<VoiceExample>();

        const idea = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/ideas`,
            payload: { text: 'Bug di una riga' },
          })
        ).json<Idea>();
        llm.responses.push({
          title: 'Bug',
          variants: [
            {
              platform: 'linkedin',
              body: 'Testo',
              hashtags: [],
              title: null,
              description: null,
              firstComment: null,
            },
          ],
        });
        const generated = await ctx.call({
          method: 'POST',
          url: '/contents/generate',
          payload: { ideaId: idea.id, platforms: ['linkedin'] },
        });
        expect(generated.statusCode).toBe(201);
        const prompt = llm.lastPrompt();
        expect(prompt).toContain('- Niente emoji');
        expect(prompt).toContain('[Instagram (chiusura)]');
        expect(prompt).toContain('Una settimana bloccato.');

        const removed = await ctx.call({ method: 'DELETE', url: `/voice-examples/${example.id}` });
        expect(removed.statusCode).toBe(204);
        const list = await ctx.call({ method: 'GET', url: `/brands/${brandId}/voice-examples` });
        expect(list.json()).toEqual([]);
      },
      { llm },
    );
  });
});
