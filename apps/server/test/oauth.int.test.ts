import { afterAll, describe, expect, it } from 'vitest';
import type { SocialAccount } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { socialAccounts } from '../src/db/schema.js';
import { deriveStateSecret } from '../src/modules/oauth/config.js';
import type { LinkedInOAuthConfig } from '../src/modules/oauth/linkedin-service.js';
import { createLinkedInClient } from '../src/publishers/linkedin/client.js';
import { FakeLinkedIn } from './helpers/fake-linkedin.js';
import {
  NOW,
  TEST_CIPHER,
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const DAY = 24 * 60 * 60 * 1000;

function oauthConfig(linkedin = FakeLinkedIn.happyPath()): LinkedInOAuthConfig {
  return {
    client: createLinkedInClient({ apiVersion: '202611', fetch: linkedin.fetch }),
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost:4000/oauth/linkedin/callback',
    cipher: TEST_CIPHER,
    stateSecret: deriveStateSecret(Buffer.alloc(32, 1).toString('base64')),
  };
}

async function startAndGetState(ctx: TestContext, brandId: number): Promise<URL> {
  const res = await ctx.call({ method: 'GET', url: `/oauth/linkedin/start?brandId=${brandId}` });
  expect(res.statusCode).toBe(200);
  return new URL(res.json<{ url: string }>().url);
}

describe.skipIf(!databaseUrl)('collegamento account LinkedIn (MySQL, API simulate)', () => {
  afterAll(closeDatabase);

  it('costruisce l’URL di autorizzazione con scope e state', () =>
    withRollback(
      async (ctx) => {
        const url = await startAndGetState(ctx, await ctx.createBrand());
        expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
          response_type: 'code',
          client_id: 'client-id',
          redirect_uri: 'http://localhost:4000/oauth/linkedin/callback',
          scope: 'openid profile w_member_social',
        });
        expect(url.searchParams.get('state')).toBeTruthy();
      },
      { linkedinOAuth: oauthConfig() },
    ));

  it('salva l’account con il token cifrato e lo aggiorna se lo ricolleghi', async () => {
    const linkedin = FakeLinkedIn.happyPath();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const state = (await startAndGetState(ctx, brandId)).searchParams.get('state')!;

        // La callback arriva dal browser: senza token API.
        const callback = await ctx.callAnonymous({
          method: 'GET',
          url: `/oauth/linkedin/callback?code=codice-1&state=${encodeURIComponent(state)}`,
        });
        expect(callback.statusCode).toBe(200);
        expect(callback.headers['content-type']).toMatch(/text\/html/);
        expect(callback.body).toContain('Marta Rossi');

        const tokenRequest = linkedin.requests.find((r) => r.url.includes('/accessToken'))!;
        expect(Object.fromEntries(new URLSearchParams(tokenRequest.body))).toMatchObject({
          grant_type: 'authorization_code',
          code: 'codice-1',
          client_id: 'client-id',
          client_secret: 'client-secret',
        });

        const [row] = await ctx.tx
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.brandId, brandId));
        expect(row).toMatchObject({
          platform: 'linkedin',
          externalId: 'abc123',
          status: 'collegato',
        });
        expect(row!.accessTokenEnc.toString('utf8')).not.toContain('access-123');
        expect(TEST_CIPHER.decrypt(row!.accessTokenEnc, tokenContext('linkedin', 'abc123'))).toBe(
          'access-123',
        );
        expect(row!.tokenExpiresAt!.getTime()).toBe(NOW.getTime() + 60 * DAY);

        const state2 = (await startAndGetState(ctx, brandId)).searchParams.get('state')!;
        await ctx.callAnonymous({
          method: 'GET',
          url: `/oauth/linkedin/callback?code=codice-2&state=${encodeURIComponent(state2)}`,
        });
        const accounts = await ctx.call({
          method: 'GET',
          url: `/brands/${brandId}/social-accounts`,
        });
        expect(accounts.json<SocialAccount[]>()).toHaveLength(1);
        expect(accounts.json<SocialAccount[]>()[0]).not.toHaveProperty('accessTokenEnc');
      },
      { linkedinOAuth: oauthConfig(linkedin) },
    );
  });

  it('rifiuta callback con state falso e mostra il consenso negato', () =>
    withRollback(
      async (ctx) => {
        const forged = await ctx.callAnonymous({
          method: 'GET',
          url: '/oauth/linkedin/callback?code=x&state=falso.firma',
        });
        expect(forged.statusCode).toBe(401);

        const state = (await startAndGetState(ctx, await ctx.createBrand())).searchParams.get(
          'state',
        )!;
        const denied = await ctx.callAnonymous({
          method: 'GET',
          url: `/oauth/linkedin/callback?error=user_cancelled_authorize&error_description=Annullato&state=${encodeURIComponent(state)}`,
        });
        expect(denied.statusCode).toBe(400);
        expect(denied.body).toContain('Annullato');
      },
      { linkedinOAuth: oauthConfig() },
    ));

  it('risponde 503 se le credenziali LinkedIn non sono configurate', () =>
    withRollback(async (ctx) => {
      const res = await ctx.call({
        method: 'GET',
        url: `/oauth/linkedin/start?brandId=${await ctx.createBrand()}`,
      });
      expect(res.statusCode).toBe(503);
    }));

  it('segnala da rinnovare un account con il token in scadenza', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const accountId = await ctx.createAccount(brandId, 'linkedin');
      await ctx.tx
        .update(socialAccounts)
        .set({ tokenExpiresAt: new Date(NOW.getTime() + 5 * DAY) })
        .where(eq(socialAccounts.id, accountId));
      const res = await ctx.call({ method: 'GET', url: `/brands/${brandId}/social-accounts` });
      expect(res.json<SocialAccount[]>()[0]!.status).toBe('da_rinnovare');
    }));
});
