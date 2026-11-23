import { afterAll, describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  Content,
  EditVariantResult,
  Idea,
  Variant,
  VariantRevision,
} from '@prisma-app/shared';
import { FakeLlm } from './helpers/fake-llm.js';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const GENERATED = {
  title: 'Client database in .NET',
  variants: [
    {
      platform: 'linkedin',
      body: 'Ho passato 3 mesi a costruire un client database da zero.',
      hashtags: ['#dotnet', 'avalonia', 'non valido!'],
      title: null,
      description: null,
      firstComment: 'Repo: [link]',
    },
    {
      platform: 'youtube',
      body: 'Nuovo video sul client database.',
      hashtags: ['dotnet'],
      title: 'Ho costruito un client database da zero',
      description: 'Cosa ho imparato.',
      firstComment: null,
    },
  ],
};

async function createIdea(ctx: TestContext): Promise<Idea> {
  const brandId = await ctx.createBrand();
  const tag = await ctx.call({
    method: 'POST',
    url: `/brands/${brandId}/tags`,
    payload: { name: '.NET' },
  });
  return (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/ideas`,
      payload: { text: 'Client database in .NET + Avalonia', tagIds: [tag.json().id] },
    })
  ).json<Idea>();
}

async function generate(ctx: TestContext, llm: FakeLlm): Promise<Content> {
  const idea = await createIdea(ctx);
  llm.responses.push(GENERATED);
  const res = await ctx.call({
    method: 'POST',
    url: '/contents/generate',
    payload: { ideaId: idea.id, platforms: ['linkedin', 'youtube'] },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json<Content>();
}

describe.skipIf(!databaseUrl)('funzioni AI (MySQL, LLM finto)', () => {
  afterAll(closeDatabase);

  it('genera un contenuto con una bozza per piattaforma', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await generate(ctx, llm);
        expect(content.title).toBe('Client database in .NET');
        const [linkedin, youtube] = content.variants;
        expect(linkedin).toMatchObject({
          platform: 'linkedin',
          format: 'post',
          status: 'bozza',
          metadata: { hashtags: ['#dotnet', '#avalonia'], firstComment: 'Repo: [link]' },
        });
        expect(linkedin!.metadata).not.toHaveProperty('title');
        expect(youtube!.metadata).toMatchObject({
          title: 'Ho costruito un client database da zero',
        });

        const prompt = llm.lastPrompt();
        expect(prompt).toContain('Client database in .NET + Avalonia');
        expect(prompt).toContain('### LinkedIn');
        expect(prompt).toContain('### YouTube');
        expect(prompt).not.toContain('### TikTok');

        const revisions = await ctx.call({
          method: 'GET',
          url: `/variants/${linkedin!.id}/revisions`,
        });
        expect(revisions.json<VariantRevision[]>()).toMatchObject([{ source: 'llm_generate' }]);

        const idea = await ctx.call({ method: 'GET', url: `/ideas/${content.ideaId}` });
        expect(idea.json<Idea>().status).toBe('in_lavorazione');
      },
      { llm },
    );
  });

  it('non salva nulla se il modello salta una piattaforma', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const idea = await createIdea(ctx);
        llm.responses.push({ ...GENERATED, variants: [GENERATED.variants[0]] });
        const res = await ctx.call({
          method: 'POST',
          url: '/contents/generate',
          payload: { ideaId: idea.id, platforms: ['linkedin', 'youtube'] },
        });
        expect(res.statusCode).toBe(502);
        const list = await ctx.call({ method: 'GET', url: `/brands/${idea.brandId}/contents` });
        expect(list.json<Content[]>()).toHaveLength(0);
      },
      { llm },
    );
  });

  it('risponde 503 se l’LLM non è configurato', () =>
    withRollback(async (ctx) => {
      const idea = await createIdea(ctx);
      const res = await ctx.call({
        method: 'POST',
        url: '/contents/generate',
        payload: { ideaId: idea.id, platforms: ['linkedin'] },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'llm_non_configurato' });
    }));

  it('modifica una bozza approvata scrivendo: torna bozza e resta nello storico', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await generate(ctx, llm);
        let variant = content.variants[0]!;
        for (const action of ['submit', 'approve']) {
          variant = (
            await ctx.call({
              method: 'POST',
              url: `/variants/${variant.id}/transitions`,
              payload: { action, expectedVersion: variant.version },
            })
          ).json<Variant>();
        }

        llm.responses.push({
          reply: "Ho ridotto l'apertura a una riga.",
          body: '3 mesi, un client database da zero.',
          hashtags: ['dotnet'],
          firstComment: 'Repo: [link]',
        });
        const res = await ctx.call({
          method: 'POST',
          url: `/variants/${variant.id}/edit`,
          payload: { instruction: "accorcia l'inizio", expectedVersion: variant.version },
        });
        expect(res.statusCode).toBe(200);
        const result = res.json<EditVariantResult>();
        expect(result).toMatchObject({
          reply: "Ho ridotto l'apertura a una riga.",
          before: GENERATED.variants[0]!.body,
          after: '3 mesi, un client database da zero.',
          variant: {
            status: 'bozza',
            approvedAt: null,
            body: '3 mesi, un client database da zero.',
          },
        });
        expect(llm.lastPrompt()).toContain(GENERATED.variants[0]!.body);

        const chat = (await ctx.call({ method: 'GET', url: `/contents/${content.id}/chat` })).json<
          ChatMessage[]
        >();
        expect(chat.map((m) => [m.role, m.text])).toEqual([
          ['user', "accorcia l'inizio"],
          ['assistant', "Ho ridotto l'apertura a una riga."],
        ]);
        expect(chat[1]!.revisionId).toBe(result.revisionId);

        // La modifica successiva vede la conversazione precedente.
        llm.responses.push({ reply: 'Fatto.', body: 'Testo più tecnico.', hashtags: [] });
        await ctx.call({
          method: 'POST',
          url: `/variants/${variant.id}/edit`,
          payload: { instruction: 'più tecnico', expectedVersion: result.variant.version },
        });
        expect(llm.lastPrompt()).toContain("Autore: accorcia l'inizio");

        // Ctrl+Z: ripristina la revisione generata dall'LLM all'inizio.
        const revisions = (
          await ctx.call({ method: 'GET', url: `/variants/${variant.id}/revisions` })
        ).json<VariantRevision[]>();
        const original = revisions.find((r) => r.source === 'llm_generate')!;
        const current = (
          await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
        ).json<Variant>();
        const restored = await ctx.call({
          method: 'POST',
          url: `/variants/${variant.id}/revisions/${original.id}/restore`,
          payload: { expectedVersion: current.version },
        });
        expect(restored.json<Variant>()).toMatchObject({
          body: GENERATED.variants[0]!.body,
          status: 'bozza',
        });
      },
      { llm },
    );
  });

  it('la modifica scrivendo conserva il carosello senza mandarlo al modello', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await generate(ctx, llm);
        const variant = content.variants[0]!;
        const carousel = {
          template: 'chiaro',
          kicker: 'client-db',
          slides: [{ kind: 'cover', title: 'SLIDE-SEGRETA', body: '', code: '' }],
        };
        const patched = (
          await ctx.call({
            method: 'PATCH',
            url: `/variants/${variant.id}`,
            payload: {
              body: variant.body,
              metadata: { ...variant.metadata, carousel },
              expectedVersion: variant.version,
            },
          })
        ).json<Variant>();
        expect(patched.metadata.carousel).toEqual(carousel);

        llm.responses.push({ reply: 'Fatto.', body: 'Più breve.', hashtags: [] });
        const res = await ctx.call({
          method: 'POST',
          url: `/variants/${variant.id}/edit`,
          payload: { instruction: 'accorcia', expectedVersion: patched.version },
        });
        expect(res.json<EditVariantResult>().variant.metadata.carousel).toEqual(carousel);
        expect(llm.lastPrompt()).not.toContain('SLIDE-SEGRETA');
      },
      { llm },
    );
  });

  it('non chiama il modello se la versione è superata', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const content = await generate(ctx, llm);
        const variant = content.variants[0]!;
        const callsBefore = llm.requests.length;

        const stale = await ctx.call({
          method: 'POST',
          url: `/variants/${variant.id}/edit`,
          payload: { instruction: 'accorcia', expectedVersion: variant.version + 5 },
        });
        expect(stale.statusCode).toBe(409);
        expect(llm.requests).toHaveLength(callsBefore);
      },
      { llm },
    );
  });

  it('genera l’articolo del blog con una chiamata a parte e ne ripulisce l’HTML', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const idea = await createIdea(ctx);
        // Ordine delle chiamate: prima i social, poi l'articolo.
        llm.responses.push(
          { ...GENERATED, variants: [GENERATED.variants[0]] },
          {
            title: 'Perché uso ancora VB.NET nel 2026',
            description: 'Esempi dal lavoro vero: quando VB.NET ha ancora senso e quando no.',
            body: '<h1>Intro</h1><p onclick="x()">Testo <strong>forte</strong></p><script>alert(1)</script>',
            hashtags: ['dotnet', '#vbnet'],
          },
        );
        const res = await ctx.call({
          method: 'POST',
          url: '/contents/generate',
          payload: { ideaId: idea.id, platforms: ['linkedin', 'blog'] },
        });
        expect(res.statusCode).toBe(201);
        const content = res.json<Content>();
        const blog = content.variants.find((v) => v.platform === 'blog')!;
        expect(blog).toMatchObject({
          format: 'articolo',
          body: '<h2>Intro</h2><p>Testo <strong>forte</strong></p>',
          metadata: {
            title: 'Perché uso ancora VB.NET nel 2026',
            description: 'Esempi dal lavoro vero: quando VB.NET ha ancora senso e quando no.',
            hashtags: ['#dotnet', '#vbnet'],
          },
        });
        expect(llm.requests).toHaveLength(2);
        expect(llm.requests[1]!.map((m) => m.content).join(' ')).toContain('### Blog');
        expect(llm.requests[0]!.map((m) => m.content).join(' ')).not.toContain('### Blog');

        // Anche una modifica a mano viene ripulita.
        const patched = await ctx.call({
          method: 'PATCH',
          url: `/variants/${blog.id}`,
          payload: {
            body: '<p>Nuovo</p><img src="x" onerror="alert(1)"><a href="javascript:x()">link</a>',
            metadata: blog.metadata,
            expectedVersion: blog.version,
          },
        });
        expect(patched.json<Variant>().body).toBe(
          '<p>Nuovo</p><a rel="noopener noreferrer">link</a>',
        );
      },
      { llm },
    );
  });

  it('genera solo l’articolo quando è l’unica piattaforma richiesta', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const idea = await createIdea(ctx);
        llm.responses.push({
          title: 'Titolo articolo',
          description: 'Estratto.',
          body: '<p>Corpo</p>',
          hashtags: [],
        });
        const res = await ctx.call({
          method: 'POST',
          url: '/contents/generate',
          payload: { ideaId: idea.id, platforms: ['blog'] },
        });
        expect(res.json<Content>()).toMatchObject({ title: 'Titolo articolo' });
        expect(llm.requests).toHaveLength(1);
      },
      { llm },
    );
  });
});
