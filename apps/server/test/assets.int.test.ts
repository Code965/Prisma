import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_KIT,
  type Brand,
  type Carousel,
  type Content,
  type Variant,
  type VariantAsset,
} from '@prisma-app/shared';
import { renderInputKey } from '@prisma-app/templates';
import { createHash } from 'node:crypto';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const CAROUSEL: Carousel = {
  template: 'scuro',
  kicker: 'client-db',
  slides: [
    { kind: 'cover', title: 'Copertina', body: '', code: '' },
    { kind: 'cta', title: 'Fine', body: '', code: '' },
  ],
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function carouselVariant(ctx: TestContext) {
  const brandId = await ctx.createBrand();
  const brand = (await ctx.call({ method: 'GET', url: `/brands/${brandId}` })).json<Brand>();
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Client', platforms: ['instagram'] },
    })
  ).json<Content>();
  const draft = content.variants[0]!;
  const variant = (
    await ctx.call({
      method: 'PATCH',
      url: `/variants/${draft.id}`,
      payload: {
        body: 'Testo',
        metadata: { hashtags: [], carousel: CAROUSEL },
        expectedVersion: draft.version,
      },
    })
  ).json<Variant>();
  const renderHash = sha(renderInputKey(CAROUSEL, DEFAULT_BRAND_KIT, brand.initials));
  return { brandId, variant, renderHash };
}

const jpg = (position: number) => ({
  position,
  mime: 'image/jpeg',
  sizeBytes: 1000 + position,
  width: 1080,
  height: 1350,
  checksumSha256: sha(`slide-${position}`),
  localPath: `C:\\esportazioni\\slide-${position + 1}.jpg`,
});

describe.skipIf(!databaseUrl)('file esportati del carosello (MySQL)', () => {
  afterAll(closeDatabase);

  it('registra il JPEG di ogni slide e lo sostituisce al nuovo export', async () => {
    await withRollback(async (ctx) => {
      const { variant, renderHash } = await carouselVariant(ctx);
      const url = `/variants/${variant.id}/assets/export`;
      const first = await ctx.call({
        method: 'PUT',
        url,
        payload: { format: 'jpg', renderHash, files: [jpg(0), jpg(1)] },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json<VariantAsset[]>()).toMatchObject([
        { kind: 'image', position: 0, width: 1080, upToDate: true },
        { kind: 'image', position: 1, upToDate: true },
      ]);

      await ctx.call({
        method: 'PUT',
        url,
        payload: { format: 'jpg', renderHash, files: [jpg(0), jpg(1)] },
      });
      const pdf = await ctx.call({
        method: 'PUT',
        url,
        payload: {
          format: 'pdf',
          renderHash,
          files: [{ ...jpg(0), mime: 'application/pdf', localPath: 'C:\\carosello.pdf' }],
        },
      });
      const all = pdf.json<VariantAsset[]>();
      expect(all.map((a) => [a.kind, a.position])).toEqual([
        ['image', 0],
        ['image', 1],
        ['pdf', 0],
      ]);

      // Lo stato della variant non cambia: i file derivano dalle slide salvate.
      const after = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
      ).json<Variant>();
      expect(after.version).toBe(variant.version);
    });
  });

  it('rifiuta export non aggiornati o incompleti e segnala quelli superati', async () => {
    await withRollback(async (ctx) => {
      const { brandId, variant, renderHash } = await carouselVariant(ctx);
      const url = `/variants/${variant.id}/assets/export`;
      const stale = await ctx.call({
        method: 'PUT',
        url,
        payload: { format: 'jpg', renderHash: sha('altro'), files: [jpg(0), jpg(1)] },
      });
      expect(stale.statusCode).toBe(409);
      const incomplete = await ctx.call({
        method: 'PUT',
        url,
        payload: { format: 'jpg', renderHash, files: [jpg(0)] },
      });
      expect(incomplete.statusCode).toBe(422);

      await ctx.call({
        method: 'PUT',
        url,
        payload: { format: 'jpg', renderHash, files: [jpg(0), jpg(1)] },
      });
      // Cambiare il brand kit rende superati i file esportati.
      await ctx.call({
        method: 'PUT',
        url: `/brands/${brandId}/kit`,
        payload: { ...DEFAULT_BRAND_KIT, handle: 'nuovo' },
      });
      const list = await ctx.call({ method: 'GET', url: `/variants/${variant.id}/assets` });
      expect(list.json<VariantAsset[]>().every((a) => !a.upToDate)).toBe(true);
    });
  });
});
