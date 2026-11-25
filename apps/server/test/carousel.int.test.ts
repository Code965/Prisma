import { afterAll, describe, expect, it } from 'vitest';
import type { Content, EditCarouselResult, Variant, VariantRevision } from '@prisma-app/shared';
import { FakeLlm } from './helpers/fake-llm.js';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const SLIDES = [
  { kind: 'cover', title: 'Ho costruito un client database', body: '3 lezioni', code: null },
  { kind: 'list', title: 'Lo stack', body: 'C#\nAvalonia' },
  { kind: 'cta', title: 'Video su YouTube', body: 'Link nel profilo.', code: '' },
];

async function contentWithText(ctx: TestContext): Promise<Content> {
  const brandId = await ctx.createBrand();
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Client database', platforms: ['linkedin', 'youtube'] },
    })
  ).json<Content>();
  const linkedin = content.variants.find((v) => v.platform === 'linkedin')!;
  await ctx.call({
    method: 'PATCH',
    url: `/variants/${linkedin.id}`,
    payload: {
      body: 'Ho passato 3 mesi a costruire un client database.',
      metadata: { hashtags: [] },
      expectedVersion: linkedin.version,
    },
  });
  return (await ctx.call({ method: 'GET', url: `/contents/${content.id}` })).json<Content>();
}

describe.skipIf(!databaseUrl)('carosello con l’LLM (MySQL, LLM finto)', () => {
  afterAll(closeDatabase);

  it('genera le slide dal testo: la variant diventa carosello e torna bozza', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await contentWithText(ctx);
        const linkedin = content.variants.find((v) => v.platform === 'linkedin')!;
        llm.responses.push({ kicker: 'client-db', slides: SLIDES });
        const res = await ctx.call({
          method: 'POST',
          url: `/variants/${linkedin.id}/carousel/generate`,
          payload: { expectedVersion: linkedin.version },
        });
        expect(res.statusCode).toBe(200);
        const variant = res.json<Variant>();
        expect(variant).toMatchObject({
          format: 'carosello',
          status: 'bozza',
          body: linkedin.body,
        });
        expect(variant.metadata.carousel).toEqual({
          template: 'scuro',
          kicker: 'client-db',
          slides: [
            {
              kind: 'cover',
              title: 'Ho costruito un client database',
              body: '3 lezioni',
              code: '',
            },
            { kind: 'list', title: 'Lo stack', body: 'C#\nAvalonia', code: '' },
            { kind: 'cta', title: 'Video su YouTube', body: 'Link nel profilo.', code: '' },
          ],
        });
        expect(llm.lastPrompt()).toContain('Ho passato 3 mesi');

        const revisions = (
          await ctx.call({ method: 'GET', url: `/variants/${linkedin.id}/revisions` })
        ).json<VariantRevision[]>();
        expect(revisions[0]).toMatchObject({
          source: 'llm_edit',
          instruction: 'Crea il carosello dal testo del post',
        });

        // Togliendo le slide a mano la variant torna un post.
        const plain = await ctx.call({
          method: 'PATCH',
          url: `/variants/${linkedin.id}`,
          payload: {
            body: variant.body,
            metadata: { hashtags: [] },
            expectedVersion: variant.version,
          },
        });
        expect(plain.json<Variant>().format).toBe('post');
      },
      { llm },
    );
  });

  it('le slide nuove prendono il template predefinito del brand kit', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await contentWithText(ctx);
        const linkedin = content.variants.find((v) => v.platform === 'linkedin')!;
        const kit = await ctx.call({ method: 'GET', url: `/brands/${content.brandId}/kit` });
        await ctx.call({
          method: 'PUT',
          url: `/brands/${content.brandId}/kit`,
          payload: { ...kit.json<object>(), carouselTemplate: 'bold' },
        });
        llm.responses.push({ kicker: 'client-db', slides: SLIDES });
        const res = await ctx.call({
          method: 'POST',
          url: `/variants/${linkedin.id}/carousel/generate`,
          payload: { expectedVersion: linkedin.version },
        });
        expect(res.json<Variant>().metadata.carousel?.template).toBe('bold');
      },
      { llm },
    );
  });

  it('modifica la slide scrivendo oppure propone titoli senza salvare', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await contentWithText(ctx);
        const linkedin = content.variants.find((v) => v.platform === 'linkedin')!;
        llm.responses.push({ kicker: 'client-db', slides: SLIDES });
        const generated = (
          await ctx.call({
            method: 'POST',
            url: `/variants/${linkedin.id}/carousel/generate`,
            payload: { expectedVersion: linkedin.version },
          })
        ).json<Variant>();

        llm.responses.push({
          reply: 'Tre proposte. Scegline una:',
          slides: null,
          proposals: ['Uno', 'Due', 'Tre'],
        });
        const proposals = await ctx.call({
          method: 'POST',
          url: `/variants/${linkedin.id}/carousel/edit`,
          payload: {
            instruction: 'proponi titoli',
            expectedVersion: generated.version,
            slideIndex: 0,
          },
        });
        expect(proposals.json<EditCarouselResult>()).toEqual({
          reply: 'Tre proposte. Scegline una:',
          variant: null,
          proposals: ['Uno', 'Due', 'Tre'],
        });
        expect(llm.lastPrompt()).toContain('slide 1');

        llm.responses.push({
          reply: 'Ho accorciato il titolo.',
          slides: [{ ...SLIDES[0], title: 'Un client DB da zero' }, SLIDES[1], SLIDES[2]],
        });
        const edited = (
          await ctx.call({
            method: 'POST',
            url: `/variants/${linkedin.id}/carousel/edit`,
            payload: { instruction: 'accorcia', expectedVersion: generated.version, slideIndex: 0 },
          })
        ).json<EditCarouselResult>();
        expect(edited.variant!.metadata.carousel).toMatchObject({
          kicker: 'client-db',
          slides: [
            { title: 'Un client DB da zero' },
            { title: 'Lo stack' },
            { title: 'Video su YouTube' },
          ],
        });
        expect(edited.variant!.version).toBeGreaterThan(generated.version);
      },
      { llm },
    );
  });

  it('rifiuta le piattaforme senza caroselli senza chiamare il modello', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await contentWithText(ctx);
        const youtube = content.variants.find((v) => v.platform === 'youtube')!;
        const res = await ctx.call({
          method: 'POST',
          url: `/variants/${youtube.id}/carousel/generate`,
          payload: { expectedVersion: youtube.version },
        });
        expect(res.statusCode).toBe(422);
        expect(llm.requests).toHaveLength(0);
      },
      { llm },
    );
  });
});
