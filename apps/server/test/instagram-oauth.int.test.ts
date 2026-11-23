import { afterAll, describe, expect, it } from 'vitest';
import type { SocialAccount } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { socialAccounts } from '../src/db/schema.js';
import { deriveStateSecret } from '../src/modules/oauth/config.js';
import type { InstagramOAuthConfig } from '../src/modules/oauth/instagram-service.js';
import { createInstagramClient } from '../src/publishers/instagram/client.js';
import { createServices } from '../src/services.js';
import { FakeInstagram } from './helpers/fake-instagram.js';
import {
  NOW,
  TEST_CIPHER,
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const DAY = 24 * 60 * 60 * 1000;

function oauthConfig(instagram = FakeInstagram.happyPath()): InstagramOAuthConfig {
  return {
    client: createInstagramClient({ apiVersion: 'v27.0', fetch: instagram.fetch }),
    appId: '990602627938098',
    appSecret: 'segreto-app',
    redirectUri: 'http://localhost:4000/oauth/instagram/callback',
    cipher: TEST_CIPHER,
    stateSecret: deriveStateSecret(Buffer.alloc(32, 2).toString('base64')),
  };
}

async function connect(ctx: TestContext, brandId: number): Promise<SocialAccount> {
  const start = await ctx.call({ method: 'GET', url: `/oauth/instagram/start?brandId=${brandId}` });
  const state = new URL(start.json<{ url: string }>().url).searchParams.get('state')!;
  const callback = await ctx.callAnonymous({
    method: 'GET',
    // Instagram aggiunge "#_" al codice: arriva codificato se il browser lo passa così.
    url: `/oauth/instagram/callback?code=${encodeURIComponent('codice-1#_')}&state=${encodeURIComponent(state)}`,
  });
  expect(callback.statusCode).toBe(200);
  expect(callback.body).toContain('@marta.dev');
  const accounts = (
    await ctx.call({ method: 'GET', url: `/brands/${brandId}/social-accounts` })
  ).json<SocialAccount[]>();
  return accounts.find((a) => a.platform === 'instagram')!;
}

describe.skipIf(!databaseUrl)('collegamento account Instagram (MySQL, API simulate)', () => {
  afterAll(closeDatabase);

  it('costruisce l’URL di Business Login con gli scope di pubblicazione', () =>
    withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const res = await ctx.call({
          method: 'GET',
          url: `/oauth/instagram/start?brandId=${brandId}`,
        });
        const url = new URL(res.json<{ url: string }>().url);
        expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
          client_id: '990602627938098',
          response_type: 'code',
          scope:
            'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
        });
      },
      { instagramOAuth: oauthConfig() },
    ));

  it('scambia il codice, prende il token di 60 giorni e salva l’account cifrato', async () => {
    const instagram = FakeInstagram.happyPath();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const account = await connect(ctx, brandId);
        expect(account).toMatchObject({
          platform: 'instagram',
          displayName: '@marta.dev',
          status: 'collegato',
          tokenExpiresAt: new Date(NOW.getTime() + 60 * DAY).toISOString(),
        });

        const exchange = instagram.requests.find((r) => r.url.pathname === '/oauth/access_token')!;
        expect(exchange.params.get('code')).toBe('codice-1');
        expect(exchange.params.get('grant_type')).toBe('authorization_code');
        const longLived = instagram.requests.find((r) => r.url.pathname === '/access_token')!;
        expect(longLived.params.get('grant_type')).toBe('ig_exchange_token');
        expect(longLived.params.get('access_token')).toBe('breve-1');

        const [row] = await ctx.tx
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.id, account.id));
        expect(row!.externalId).toBe('1789');
        expect(TEST_CIPHER.decrypt(row!.accessTokenEnc, tokenContext('instagram', '1789'))).toBe(
          'lungo-1',
        );
      },
      { instagramOAuth: oauthConfig(instagram) },
    );
  });

  it('rinnova i token vicini alla scadenza e non tocca quelli giovani', async () => {
    const instagram = FakeInstagram.happyPath();
    const config = oauthConfig(instagram);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const account = await connect(ctx, brandId);
        const later = new Date(NOW.getTime() + 50 * DAY);
        const service = createServices(ctx.tx, {
          instagramOAuth: config,
          now: () => later,
        }).instagramOAuth;

        // Appena collegato e a 10 giorni dalla scadenza (vecchio di 50): va rinnovato.
        await ctx.tx
          .update(socialAccounts)
          .set({ updatedAt: NOW })
          .where(eq(socialAccounts.id, account.id));
        expect(await service.refreshExpiring()).toEqual({ refreshed: 1, failed: 0 });
        const [row] = await ctx.tx
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.id, account.id));
        expect(TEST_CIPHER.decrypt(row!.accessTokenEnc, tokenContext('instagram', '1789'))).toBe(
          'rinnovato-1',
        );
        expect(row!.tokenExpiresAt!.getTime()).toBe(later.getTime() + 60 * DAY);

        // Ora scade tra 60 giorni: niente da fare.
        expect(await service.refreshExpiring()).toEqual({ refreshed: 0, failed: 0 });
      },
      { instagramOAuth: config },
    );
  });
});
