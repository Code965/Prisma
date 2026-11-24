import { afterAll, describe, expect, it } from 'vitest';
import { createTokenCipher } from '../src/crypto/token-cipher.js';
import { searchUrl, toStockItem } from '../src/modules/stock/service.js';
import { StockSearchQuerySchema } from '@prisma-app/shared';
import { closeDatabase, withRollback } from './helpers/integration.js';

const cipher = createTokenCipher(Buffer.alloc(32, 9).toString('base64'));
const KEY = '12345678-abcdefabcdefabcdef';

const VIDEO_HIT = {
  id: 125,
  pageURL: 'https://pixabay.com/videos/id-125/',
  tags: 'keyboard, typing',
  user: 'Coverr-Free-Footage',
  duration: 12,
  videos: {
    large: { url: 'https://cdn.pixabay.com/video/125_large.mp4', width: 3840, height: 2160 },
    medium: {
      url: 'https://cdn.pixabay.com/video/125_medium.mp4',
      width: 1920,
      height: 1080,
      thumbnail: 'https://cdn.pixabay.com/video/125_medium.jpg',
    },
  },
};

/** Pixabay finto: risponde alle ricerche e conta le chiamate (per la cache). */
function fakePixabay() {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (!url.includes(`key=${KEY}`))
      return new Response('[ERROR 400] "key" is wrong or missing.', { status: 400 });
    const hits = url.includes('/videos/')
      ? [VIDEO_HIT]
      : [
          {
            id: 7,
            pageURL: 'https://pixabay.com/photos/id-7/',
            user: 'a',
            largeImageURL: 'https://pixabay.com/get/7_1280.jpg',
            webformatURL: 'https://pixabay.com/get/7_640.jpg',
            imageWidth: 4000,
            imageHeight: 6000,
          },
        ];
    return Response.json({ total: hits.length, totalHits: hits.length, hits });
  }) as typeof fetch;
  return { calls, fetch: fakeFetch };
}

describe('archivio di B-roll (Pixabay finto)', () => {
  afterAll(closeDatabase);

  it('senza chiave la ricerca risponde 503, una chiave sbagliata 422', async () => {
    const pixabay = fakePixabay();
    await withRollback(
      async (ctx) => {
        expect((await ctx.call({ method: 'GET', url: '/stock/status' })).json()).toEqual({
          configured: false,
        });
        expect((await ctx.call({ method: 'GET', url: '/stock/search?q=code' })).statusCode).toBe(
          503,
        );
        const wrong = await ctx.call({
          method: 'PUT',
          url: '/stock/key',
          payload: { apiKey: 'sbagliata-123' },
        });
        expect(wrong.statusCode).toBe(422);
        expect(wrong.json().message).toMatch(/Chiave di Pixabay non valida/);
      },
      { stock: { cipher, fetch: pixabay.fetch } },
    );
  });

  it('salva la chiave cifrata, cerca e tiene i risultati in cache', async () => {
    const pixabay = fakePixabay();
    await withRollback(
      async (ctx) => {
        const saved = await ctx.call({
          method: 'PUT',
          url: '/stock/key',
          payload: { apiKey: KEY },
        });
        expect(saved.json()).toEqual({ configured: true });
        const search = () =>
          ctx.call({ method: 'GET', url: '/stock/search?q=keyboard%20typing&kind=video' });
        const first = await search();
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({
          source: 'pixabay',
          items: [
            {
              id: 125,
              kind: 'video',
              pageUrl: 'https://pixabay.com/videos/id-125/',
              user: 'Coverr-Free-Footage',
              tags: 'keyboard, typing',
              previewUrl: 'https://cdn.pixabay.com/video/125_medium.jpg',
              downloadUrl: 'https://cdn.pixabay.com/video/125_medium.mp4',
              width: 1920,
              height: 1080,
              durationMs: 12_000,
            },
          ],
        });
        await search();
        expect(pixabay.calls.filter((u) => u.includes('/videos/'))).toHaveLength(1);
        // La chiave non torna mai al client.
        expect(JSON.stringify(first.json())).not.toContain(KEY);
        expect((await ctx.call({ method: 'DELETE', url: '/stock/key' })).json()).toEqual({
          configured: false,
        });
      },
      { stock: { cipher, fetch: pixabay.fetch } },
    );
  });

  it('foto verticali dal lato lungo di 1280 px', () => {
    const query = StockSearchQuerySchema.parse({ q: 'città', kind: 'image', lang: 'it' });
    const url = new URL(searchUrl('k', query));
    expect(url.pathname).toBe('/api/');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'città',
      lang: 'it',
      image_type: 'photo',
      orientation: 'vertical',
      safesearch: 'true',
    });
    expect(
      toStockItem(
        { id: 7, pageURL: 'p', largeImageURL: 'l', imageWidth: 4000, imageHeight: 6000 },
        'image',
      ),
    ).toMatchObject({ width: 853, height: 1280, durationMs: 0 });
  });
});
