import type { Content } from '@prisma-app/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { publications } from '../src/db/schema.js';
import { closeDatabase, withRollback } from './helpers/integration.js';

describe('eliminare un’idea e i suoi contenuti mai usciti', () => {
  afterAll(closeDatabase);

  async function setup(ctx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
    const brandId = await ctx.createBrand();
    const accountId = await ctx.createAccount(brandId, 'linkedin');
    const idea = (
      await ctx.call({ method: 'POST', url: `/brands/${brandId}/ideas`, payload: { text: 'Rust' } })
    ).json<{ id: number }>();
    const create = async (title: string) =>
      (
        await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/contents`,
          payload: { title, platforms: ['linkedin'], ideaId: idea.id },
        })
      ).json<Content>();
    const draft = await create('Bozza');
    const published = await create('Uscito');
    await ctx.tx.insert(publications).values({
      variantId: published.variants[0]!.id,
      socialAccountId: accountId,
      scheduledAt: new Date('1990-01-01T10:00:00Z'),
      status: 'pubblicato',
      publishedAt: new Date('1990-01-01T10:00:00Z'),
      externalId: 'urn:li:share:1',
      idempotencyKey: 'x'.repeat(64),
    });
    return { brandId, idea, draft, published };
  }

  it('con «contenuti=bozze» toglie le bozze e tiene i pubblicati (senza idea)', async () => {
    await withRollback(async (ctx) => {
      const { brandId, idea, draft, published } = await setup(ctx);
      const res = await ctx.call({ method: 'DELETE', url: `/ideas/${idea.id}?contenuti=bozze` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ removedContents: 1, keptContents: 1 });
      const left = (await ctx.call({ method: 'GET', url: `/brands/${brandId}/contents` })).json<
        Content[]
      >();
      expect(left.map((c) => c.id)).toEqual([published.id]);
      expect(left[0]!.ideaId).toBeNull();
      expect(left.some((c) => c.id === draft.id)).toBe(false);
      expect((await ctx.call({ method: 'GET', url: `/ideas/${idea.id}` })).statusCode).toBe(404);
    });
  });

  it('senza opzione elimina solo l’idea', async () => {
    await withRollback(async (ctx) => {
      const { brandId, idea } = await setup(ctx);
      const res = await ctx.call({ method: 'DELETE', url: `/ideas/${idea.id}` });
      expect(res.json()).toEqual({ removedContents: 0, keptContents: 2 });
      const left = (await ctx.call({ method: 'GET', url: `/brands/${brandId}/contents` })).json<
        Content[]
      >();
      expect(left).toHaveLength(2);
    });
  });
});
