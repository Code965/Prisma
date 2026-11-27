import type { Competitor, Content, Idea, Inspiration, Tag } from '@prisma-app/shared';
import { inspirationIdeaText } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeLlm } from './helpers/fake-llm.js';
import { closeDatabase, NOW, withRollback } from './helpers/integration.js';

const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const proposal = {
  mechanism: {
    hook: 'Confessione di errori ricorrenti, in prima persona',
    structure: ['Gli errori in un elenco numerato', 'Una domanda finale'],
    whyItWorked: 'Chi legge si riconosce negli errori.',
  },
  idea: {
    topic: 'docker',
    text: 'Racconta gli sbagli che facevi scrivendo i Dockerfile e come li hai corretti.',
    hook: 'Ho spedito in produzione immagini enormi per mesi.',
  },
};

describe('ispirati', () => {
  afterAll(closeDatabase);

  it("dal post di un concorrente all'idea con il riferimento e alle bozze", async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const docker = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/tags`,
            payload: { name: 'Docker' },
          })
        ).json<Tag>();
        const competitor = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/competitors`,
            payload: { name: 'Marta', platform: 'linkedin', handle: 'marta-dev' },
          })
        ).json<Competitor>();
        await ctx.call({
          method: 'POST',
          url: `/competitors/${competitor.id}/posts`,
          payload: {
            text: 'Tre errori che faccio ancora con TypeScript',
            url: 'https://www.linkedin.com/posts/marta-1',
            publishedAt: day(2),
            format: 'carosello',
            likes: 120,
            comments: 30,
            followers: 5000,
          },
        });
        const state = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/competitors` })
        ).json<{ competitors: Competitor[] }>();
        const postId = state.competitors[0]!.posts[0]!.id;

        // Un altro brand non può usare il post.
        const other = await ctx.createBrand();
        const foreign = await ctx.call({
          method: 'POST',
          url: `/brands/${other}/inspire`,
          payload: { source: { kind: 'concorrente', postId } },
        });
        expect(foreign.statusCode).toBe(404);

        llm.responses.push(proposal);
        const res = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/inspire`,
          payload: { source: { kind: 'concorrente', postId } },
        });
        expect(res.statusCode).toBe(200);
        const inspiration = res.json<Inspiration>();
        expect(inspiration).toMatchObject({
          inspiration: {
            kind: 'concorrente',
            competitorPostId: postId,
            label: 'Marta',
            platform: 'linkedin',
            url: 'https://www.linkedin.com/posts/marta-1',
          },
          signals: { likes: 120, comments: 30, views: null, basis: 'follower' },
          idea: { topic: 'docker', tagId: docker.id },
          model: 'fake',
        });
        expect(inspiration.signals!.rate).toBeCloseTo(0.03);
        const prompt = llm.lastPrompt();
        expect(prompt).toContain('Marta · LinkedIn · carosello');
        expect(prompt).toContain('like 120, commenti 30, tasso di interazione 3.0% sui follower');
        expect(prompt).toContain("Scegli l'argomento più adatto tra: Docker");
        expect(prompt).toMatch(/Non copiare/);
        // Il server non salva nulla.
        expect(
          (await ctx.call({ method: 'GET', url: `/brands/${brandId}/ideas` })).json<Idea[]>(),
        ).toHaveLength(0);

        // L'idea si crea con il riferimento, poi le bozze con il flusso di sempre.
        const created = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/ideas`,
          payload: {
            text: inspirationIdeaText(inspiration),
            source: 'suggerita',
            tagIds: [docker.id],
            targetPlatforms: ['linkedin'],
            inspiration: inspiration.inspiration,
          },
        });
        expect(created.statusCode).toBe(201);
        const idea = created.json<Idea>();
        expect(idea.inspiration).toEqual(inspiration.inspiration);
        expect(idea.text).toContain('Struttura da seguire:\n1. Gli errori in un elenco numerato');

        llm.responses.push({
          title: 'Dockerfile',
          variants: [{ platform: 'linkedin', body: 'Bozza', hashtags: ['docker'] }],
        });
        const content = (
          await ctx.call({
            method: 'POST',
            url: '/contents/generate',
            payload: { ideaId: idea.id, platforms: ['linkedin'] },
          })
        ).json<Content>();
        expect(content.variants[0]!.status).toBe('bozza');
        expect(llm.lastPrompt()).toContain('Apertura: Ho spedito in produzione');
      },
      { llm },
    );
  });

  it('da un testo incollato con un argomento scritto', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        llm.responses.push({ ...proposal, idea: { ...proposal.idea, topic: 'Kubernetes' } });
        const res = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/inspire`,
          payload: {
            source: {
              kind: 'testo',
              text: 'Show HN: un tool per deploy',
              url: 'https://news.ycombinator.com/item?id=1',
              label: 'Hacker News',
            },
            topic: 'Kubernetes',
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<Inspiration>()).toMatchObject({
          inspiration: {
            kind: 'testo',
            label: 'Hacker News',
            title: 'Show HN: un tool per deploy',
          },
          signals: null,
          idea: { topic: 'Kubernetes', tagId: null },
        });
        expect(llm.lastPrompt()).toContain('Usa esattamente questo argomento: Kubernetes');
      },
      { llm },
    );
  });

  it('senza AI configurata risponde 503', async () => {
    await withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const res = await ctx.call({
        method: 'POST',
        url: `/brands/${brandId}/inspire`,
        payload: { source: { kind: 'testo', text: 'x' } },
      });
      expect(res.statusCode).toBe(503);
    });
  });
});
