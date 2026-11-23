import { afterAll, describe, expect, it } from 'vitest';
import type { Content, Variant, VariantAsset, VariantRevision } from '@prisma-app/shared';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const file = (checksumChar: string) => ({
  mime: 'video/mp4',
  sizeBytes: 23_000_000,
  width: 1080,
  height: 1920,
  durationMs: 42_000,
  checksumSha256: checksumChar.repeat(64),
  localPath: 'C:\\esportazioni\\video-1\\20261122-120000-9x16.mp4',
});

async function approvedVariant(ctx: TestContext, platform: string): Promise<Variant> {
  const brandId = await ctx.createBrand();
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Client', platforms: [platform] },
    })
  ).json<Content>();
  let variant = (
    await ctx.call({
      method: 'PATCH',
      url: `/variants/${content.variants[0]!.id}`,
      payload: {
        body: 'Testo',
        metadata: { hashtags: [] },
        expectedVersion: content.variants[0]!.version,
      },
    })
  ).json<Variant>();
  for (const action of ['submit', 'approve']) {
    variant = (
      await ctx.call({
        method: 'POST',
        url: `/variants/${variant.id}/transitions`,
        payload: { action, expectedVersion: variant.version },
      })
    ).json<Variant>();
  }
  return variant;
}

describe.skipIf(!databaseUrl)('video collegati alle variant (MySQL)', () => {
  afterAll(closeDatabase);

  it('collega il video: formato della piattaforma, bozza da riapprovare, video precedente sostituito', async () => {
    await withRollback(async (ctx) => {
      const variant = await approvedVariant(ctx, 'instagram');
      const url = `/variants/${variant.id}/assets/video`;
      const first = await ctx.call({
        method: 'PUT',
        url,
        payload: { expectedVersion: variant.version, file: file('a') },
      });
      expect(first.statusCode).toBe(200);
      const result = first.json<{ variant: Variant; assets: VariantAsset[] }>();
      expect(result.variant).toMatchObject({ format: 'reel', status: 'bozza', approvedAt: null });
      expect(result.assets).toMatchObject([
        {
          kind: 'video',
          mime: 'video/mp4',
          durationMs: 42_000,
          width: 1080,
          upToDate: true,
          remoteKey: null,
        },
      ]);

      const second = await ctx.call({
        method: 'PUT',
        url,
        payload: { expectedVersion: result.variant.version, file: file('b') },
      });
      const assets = second.json<{ assets: VariantAsset[] }>().assets;
      expect(assets).toHaveLength(1);
      expect(assets[0]!.checksumSha256).toBe('b'.repeat(64));

      const revisions = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}/revisions` })
      ).json<VariantRevision[]>();
      expect(revisions[0]).toMatchObject({ source: 'manuale', instruction: 'Video collegato' });

      const stale = await ctx.call({
        method: 'PUT',
        url,
        payload: { expectedVersion: variant.version, file: file('c') },
      });
      expect(stale.statusCode).toBe(409);
    });
  });

  it('rifiuta le piattaforme senza video', async () => {
    await withRollback(async (ctx) => {
      const variant = await approvedVariant(ctx, 'blog');
      const res = await ctx.call({
        method: 'PUT',
        url: `/variants/${variant.id}/assets/video`,
        payload: { expectedVersion: variant.version, file: file('a') },
      });
      expect(res.statusCode).toBe(422);
    });
  });
});
