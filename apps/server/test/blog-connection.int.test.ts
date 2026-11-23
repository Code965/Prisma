import { afterAll, describe, expect, it } from 'vitest';
import type { SocialAccount } from '@prisma-app/shared';
import { and, eq } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { socialAccounts } from '../src/db/schema.js';
import { createBlogClient } from '../src/publishers/blog/client.js';
import { FakeBlog } from './helpers/fake-blog.js';
import { TEST_CIPHER, closeDatabase, databaseUrl, withRollback } from './helpers/integration.js';

function config(blog: FakeBlog) {
  return { client: createBlogClient({ fetch: blog.fetch }), cipher: TEST_CIPHER };
}

describe.skipIf(!databaseUrl)('collegamento al blog (MySQL, sito simulato)', () => {
  afterAll(closeDatabase);

  it('verifica indirizzo e chiave e salva la chiave cifrata', async () => {
    const blog = new FakeBlog();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const res = await ctx.call({
          method: 'PUT',
          url: `/brands/${brandId}/blog-connection`,
          payload: { baseUrl: 'https://api.sito.test/', apiKey: blog.apiKey },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<SocialAccount>()).toMatchObject({
          platform: 'blog',
          displayName: 'api.sito.test',
          status: 'collegato',
          tokenExpiresAt: null,
        });
        expect(blog.requests[0]!.url).toBe('https://api.sito.test/health');

        const [row] = await ctx.tx
          .select()
          .from(socialAccounts)
          .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.platform, 'blog')));
        expect(row!.externalId).toBe('https://api.sito.test');
        expect(row!.accessTokenEnc.toString('utf8')).not.toContain(blog.apiKey);
        expect(
          TEST_CIPHER.decrypt(row!.accessTokenEnc, tokenContext('blog', 'https://api.sito.test')),
        ).toBe(blog.apiKey);

        const test = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/blog-connection/test`,
        });
        expect(test.json()).toEqual({ ok: true });
      },
      { blogConnection: config(blog) },
    );
  });

  it('non salva nulla se il sito rifiuta la chiave o l’indirizzo non è https', async () => {
    const blog = new FakeBlog();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const wrongKey = await ctx.call({
          method: 'PUT',
          url: `/brands/${brandId}/blog-connection`,
          payload: { baseUrl: 'https://api.sito.test', apiKey: 'x'.repeat(40) },
        });
        expect(wrongKey.statusCode).toBe(422);
        expect(wrongKey.json().message).toMatch(/rifiutato la chiave/);

        const http = await ctx.call({
          method: 'PUT',
          url: `/brands/${brandId}/blog-connection`,
          payload: { baseUrl: 'http://sito.test', apiKey: blog.apiKey },
        });
        expect(http.statusCode).toBe(422);

        const accounts = await ctx.call({
          method: 'GET',
          url: `/brands/${brandId}/social-accounts`,
        });
        expect(accounts.json<SocialAccount[]>()).toHaveLength(0);
      },
      { blogConnection: config(blog) },
    );
  });

  it('cambiando indirizzo scollega il blog precedente', async () => {
    const blog = new FakeBlog();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        for (const baseUrl of ['https://vecchio.test', 'https://nuovo.test']) {
          await ctx.call({
            method: 'PUT',
            url: `/brands/${brandId}/blog-connection`,
            payload: { baseUrl, apiKey: blog.apiKey },
          });
        }
        const accounts = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/social-accounts` })
        ).json<SocialAccount[]>();
        expect(accounts.map((a) => [a.displayName, a.status]).sort()).toEqual([
          ['nuovo.test', 'collegato'],
          ['vecchio.test', 'scollegato'],
        ]);
      },
      { blogConnection: config(blog) },
    );
  });
});
