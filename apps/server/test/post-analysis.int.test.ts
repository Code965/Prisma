import { afterAll, describe, expect, it } from 'vitest';
import type { Content, PostAnalysis } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { contents, metricSnapshots, publications, variants } from '../src/db/schema.js';
import { FakeLlm } from './helpers/fake-llm.js';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

/** Nel 1990 come gli altri test con orologio: nessuna riga vera del database di sviluppo. */
const NOW = new Date('1990-03-01T12:00:00.000Z');
const PUBLISHED = new Date('1990-02-20T08:00:00.000Z');

async function publishedPost(
  ctx: TestContext,
  brandId: number,
  accountId: number,
  post: { title: string; body: string; ideaId?: number; views: number; likes: number },
) {
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: post.title, platforms: ['linkedin'] },
    })
  ).json<Content>();
  const variantId = content.variants[0]!.id;
  await ctx.tx.update(variants).set({ body: post.body }).where(eq(variants.id, variantId));
  if (post.ideaId) {
    await ctx.tx.update(contents).set({ ideaId: post.ideaId }).where(eq(contents.id, content.id));
  }
  const [publication] = await ctx.tx
    .insert(publications)
    .values({
      variantId,
      socialAccountId: accountId,
      scheduledAt: PUBLISHED,
      status: 'pubblicato',
      publishedAt: PUBLISHED,
      externalId: `urn:li:share:${post.title}`,
      externalUrl: `https://www.linkedin.com/feed/update/${content.id}`,
      idempotencyKey: post.title.padEnd(64, 'x').slice(0, 64),
    })
    .returning({ id: publications.id });
  await ctx.tx.insert(metricSnapshots).values({
    publicationId: publication!.id,
    capturedAt: NOW,
    impressions: post.views,
    likes: post.likes,
    comments: 0,
    source: 'manuale',
  });
  return publication!.id;
}

describe.skipIf(!databaseUrl)('analisi dei propri post', () => {
  afterAll(closeDatabase);

  it('gruppi dai post pubblicati, poi aperture e conclusioni dall’AI (senza salvare)', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const accountId = await ctx.createAccount(brandId, 'linkedin');
        const tag = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/tags`,
            payload: { name: 'Rust' },
          })
        ).json<{ id: number }>();
        const idea = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/ideas`,
            payload: {
              text: 'Rust in produzione',
              tagIds: [tag.id],
              targetPlatforms: ['linkedin'],
            },
          })
        ).json<{ id: number }>();

        const url = `/brands/${brandId}/analytics/posts`;
        const empty = (await ctx.call({ method: 'GET', url })).json<PostAnalysis>();
        expect(empty).toMatchObject({ platforms: [], ai: null, aiBlocked: /almeno 3/ });

        const ids = [
          await publishedPost(ctx, brandId, accountId, {
            title: 'Rust',
            body: 'Perché Rust? Te lo spiego.',
            ideaId: idea.id,
            views: 100,
            likes: 20,
          }),
          await publishedPost(ctx, brandId, accountId, {
            title: 'Docker',
            body: '5 errori con Docker.',
            views: 100,
            likes: 5,
          }),
          await publishedPost(ctx, brandId, accountId, {
            title: 'Git',
            body: 'Ieri ho perso un branch.',
            ideaId: idea.id,
            views: 200,
            likes: 10,
          }),
        ];

        const report = (await ctx.call({ method: 'GET', url })).json<PostAnalysis>();
        expect(report.aiBlocked).toBeNull();
        const [li] = report.platforms;
        expect(li).toMatchObject({ platform: 'linkedin', measured: 3, basis: 'visualizzazioni' });
        const topics = li!.dimensions.find((d) => d.dimension === 'argomento')!.groups;
        expect(topics.map((g) => [g.label, g.posts, g.fewData])).toEqual([
          ['Rust', 2, false],
          ['Senza argomento', 1, true],
        ]);
        expect(li!.posts.find((p) => p.publicationId === ids[0])).toMatchObject({
          opening: 'Perché Rust?',
          openingKind: 'Domanda',
          tags: ['Rust'],
          rate: 0.2,
        });

        // Al modello i post dal migliore: Rust (0,2), poi Git e Docker (0,05: Git ha più interazioni).
        llm.responses.push({
          openings: [
            { label: 'Domanda al lettore', posts: [0] },
            { label: 'Errore comune', posts: [1, 2] },
          ],
          conclusions: [
            { text: 'Le domande funzionano su LinkedIn.', posts: [0] },
            { text: 'Gli errori comuni rendono meno.', posts: [1, 2, 2] },
            { text: 'Pochi post: continua a misurare.', posts: [] },
          ],
        });
        const analyzed = await ctx.call({ method: 'POST', url });
        expect(analyzed.statusCode).toBe(200);
        const result = analyzed.json<PostAnalysis>();
        expect(result.ai).toMatchObject({
          model: 'fake',
          basedOn: 3,
          conclusions: [{ publicationIds: [ids[0]] }, { publicationIds: [ids[2], ids[1]] }, {}],
        });
        const openings = result.platforms[0]!.dimensions.find((d) => d.dimension === 'apertura')!;
        expect(openings.groups.map((g) => [g.label, g.posts])).toEqual([
          ['Errore comune', 2],
          ['Domanda al lettore', 1],
        ]);
        expect(llm.lastPrompt()).toContain('apertura: "Perché Rust?"');
        expect(llm.lastPrompt()).toContain('Argomento: Rust: 2 post');

        // Non si salva nulla: il GET torna alle aperture delle regole.
        const again = (await ctx.call({ method: 'GET', url })).json<PostAnalysis>();
        expect(again.ai).toBeNull();
      },
      { now: NOW, llm },
    );
  });
});
