import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_KIT,
  type Brand,
  type Carousel,
  type Content,
  type UploadTarget,
  type Variant,
  type VariantAsset,
} from '@prisma-app/shared';
import { renderInputKey } from '@prisma-app/templates';
import { createHash } from 'node:crypto';
import { FakeStorage } from './helpers/fake-storage.js';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const CAROUSEL: Carousel = {
  template: 'scuro',
  kicker: '',
  slides: [{ kind: 'cover', title: 'Copertina', body: '', code: '' }],
};
const PDF = Buffer.from('%PDF-1.7 prova');
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

async function exportedPdf(ctx: TestContext): Promise<{ variant: Variant; asset: VariantAsset }> {
  const brandId = await ctx.createBrand();
  const brand = (await ctx.call({ method: 'GET', url: `/brands/${brandId}` })).json<Brand>();
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Client', platforms: ['linkedin'] },
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
  const [asset] = (
    await ctx.call({
      method: 'PUT',
      url: `/variants/${variant.id}/assets/export`,
      payload: {
        format: 'pdf',
        renderHash: sha(renderInputKey(CAROUSEL, DEFAULT_BRAND_KIT, brand.initials)),
        files: [
          {
            position: 0,
            mime: 'application/pdf',
            sizeBytes: PDF.length,
            width: 1080,
            height: 1350,
            checksumSha256: sha(PDF),
            localPath: 'C:\\carosello.pdf',
          },
        ],
      },
    })
  ).json<VariantAsset[]>();
  return { variant, asset: asset! };
}

describe.skipIf(!databaseUrl)('caricamento dei file su R2 (MySQL, storage finto)', () => {
  afterAll(closeDatabase);

  it('firma il caricamento, verifica il file e salva chiave e indirizzo pubblico', async () => {
    const storage = new FakeStorage();
    await withRollback(
      async (ctx) => {
        const { variant, asset } = await exportedPdf(ctx);
        expect(asset).toMatchObject({ remoteKey: null, remoteUrl: null });
        const base = `/variants/${variant.id}/assets/${asset.assetId}/upload`;

        const target = (await ctx.call({ method: 'POST', url: base })).json<UploadTarget>();
        expect(target.key).toMatch(new RegExp(`^brand-\\d+/${sha(PDF)}\\.pdf$`));
        expect(target.headers).toEqual({ 'Content-Type': 'application/pdf' });

        const missing = await ctx.call({ method: 'POST', url: `${base}/complete` });
        expect(missing.statusCode).toBe(422);

        storage.put(target.key, Buffer.from('troncato'), 'application/pdf');
        const wrongSize = await ctx.call({ method: 'POST', url: `${base}/complete` });
        expect(wrongSize.json().message).toMatch(/caricalo di nuovo/);

        storage.put(target.key, PDF, 'application/pdf');
        const done = await ctx.call({ method: 'POST', url: `${base}/complete` });
        expect(done.statusCode).toBe(200);
        expect(done.json<VariantAsset[]>()[0]).toMatchObject({
          remoteKey: target.key,
          remoteUrl: `https://media.test/${target.key}`,
          upToDate: true,
        });

        const status = await ctx.call({ method: 'GET', url: '/storage/status' });
        expect(status.json()).toEqual({ configured: true, publicUrls: true });
      },
      { storage },
    );
  });

  it('la pulizia toglie solo i file superati da più di 7 giorni', async () => {
    const storage = new FakeStorage();
    await withRollback(
      async (ctx) => {
        const { variant, asset } = await exportedPdf(ctx);
        const base = `/variants/${variant.id}/assets/${asset.assetId}/upload`;
        const target = (await ctx.call({ method: 'POST', url: base })).json<UploadTarget>();
        storage.put(target.key, PDF, 'application/pdf');
        await ctx.call({ method: 'POST', url: `${base}/complete` });
        // Rispetto all'orologio dei test (21 novembre 2026): uno superato da anni, uno ancora recente.
        storage.put(
          'brand-1/superato.pdf',
          Buffer.from('vecchio'),
          'application/pdf',
          new Date('1989-01-01T00:00:00Z'),
        );
        storage.put(
          'brand-1/appena.pdf',
          Buffer.from('nuovo'),
          'application/pdf',
          new Date('2099-01-01T00:00:00Z'),
        );
        storage.put(
          'altro/estraneo.pdf',
          Buffer.from('x'),
          'application/pdf',
          new Date('1980-01-01T00:00:00Z'),
        );

        const res = await ctx.call({ method: 'POST', url: '/storage/cleanup' });
        expect(res.json()).toEqual({ checked: 3, deleted: 1, freedBytes: 7 });
        expect([...storage.objects.keys()].sort()).toEqual(
          ['altro/estraneo.pdf', 'brand-1/appena.pdf', target.key].sort(),
        );
      },
      { storage },
    );
  });

  it('senza R2 configurato risponde 503 e lo dice nello stato', async () => {
    await withRollback(async (ctx) => {
      const { variant, asset } = await exportedPdf(ctx);
      const res = await ctx.call({
        method: 'POST',
        url: `/variants/${variant.id}/assets/${asset.assetId}/upload`,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().message).toMatch(/R2/);
      const status = await ctx.call({ method: 'GET', url: '/storage/status' });
      expect(status.json()).toEqual({ configured: false, publicUrls: false });
    });
  });
});
