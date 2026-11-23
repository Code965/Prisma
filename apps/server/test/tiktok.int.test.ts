import { afterAll, describe, expect, it } from 'vitest';
import type { SocialAccount } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { socialAccounts } from '../src/db/schema.js';
import { deriveStateSecret } from '../src/modules/oauth/config.js';
import {
  tiktokTokenRefresher,
  type TikTokOAuthConfig,
} from '../src/modules/oauth/tiktok-service.js';
import { updateAccountTokens } from '../src/modules/social-accounts/repository.js';
import { createAccessTokenResolver } from '../src/modules/social-accounts/tokens.js';
import { createTikTokClient } from '../src/publishers/tiktok/client.js';
import { FakeTikTok } from './helpers/fake-tiktok.js';
import {
  NOW,
  TEST_CIPHER,
  closeDatabase,
  databaseUrl,
  withRollback,
} from './helpers/integration.js';

const DAY = 86_400_000;

function oauthConfig(tiktok: FakeTikTok): TikTokOAuthConfig {
  return {
    client: createTikTokClient({ fetch: tiktok.fetch, put: tiktok.put }),
    clientKey: 'awclientkey',
    clientSecret: 'segreto',
    redirectUri: 'https://prisma.test/oauth/tiktok/callback',
    cipher: TEST_CIPHER,
    stateSecret: deriveStateSecret(Buffer.alloc(32, 4).toString('base64')),
  };
}

describe.skipIf(!databaseUrl)('TikTok (MySQL, API simulate)', () => {
  afterAll(closeDatabase);

  it('collega l’account e rinnova il token salvando il refresh token ruotato', async () => {
    const tiktok = new FakeTikTok();
    const config = oauthConfig(tiktok);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const start = await ctx.call({
          method: 'GET',
          url: `/oauth/tiktok/start?brandId=${brandId}`,
        });
        const url = new URL(start.json<{ url: string }>().url);
        expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
        const state = url.searchParams.get('state')!;
        const callback = await ctx.callAnonymous({
          method: 'GET',
          url: `/oauth/tiktok/callback?code=codice&state=${encodeURIComponent(state)}`,
        });
        expect(callback.statusCode).toBe(200);
        expect(callback.body).toContain('Marta Dev');

        const account = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/social-accounts` })
        ).json<SocialAccount[]>()[0]!;
        // Conta la scadenza del refresh token (180 giorni), non quella del token di 2 ore.
        expect(account).toMatchObject({
          platform: 'tiktok',
          displayName: 'Marta Dev',
          status: 'collegato',
        });
        expect(new Date(account.tokenExpiresAt!).getTime() - NOW.getTime()).toBe(180 * DAY);

        const read = async () =>
          (await ctx.tx.select().from(socialAccounts).where(eq(socialAccounts.id, account.id)))[0]!;
        const resolve = createAccessTokenResolver(
          TEST_CIPHER,
          { tiktok: tiktokTokenRefresher(config) },
          {
            now: () => NOW,
            persist: (id, values) => updateAccountTokens(ctx.tx, id, values),
          },
        );
        // Token ancora valido: si usa quello salvato.
        await expect(resolve(await read())).resolves.toBe('accesso-1');

        // Scaduto: rinnovo, e il refresh token nuovo sostituisce il vecchio nel database.
        await ctx.tx
          .update(socialAccounts)
          .set({ tokenExpiresAt: new Date(NOW.getTime() - 1000) })
          .where(eq(socialAccounts.id, account.id));
        await expect(resolve(await read())).resolves.toBe('accesso-2');
        const row = await read();
        const context = tokenContext('tiktok', 'open-123');
        expect(TEST_CIPHER.decrypt(row.refreshTokenEnc!, context)).toBe('refresh-2');
        expect(TEST_CIPHER.decrypt(row.accessTokenEnc, context)).toBe('accesso-2');
        expect(row.tokenExpiresAt!.getTime()).toBe(NOW.getTime() + 7200 * 1000);
      },
      { tiktokOAuth: config },
    );
  });
});
