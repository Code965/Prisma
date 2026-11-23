import type { AppCredentialView } from '@prisma-app/shared';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { appCredentials } from '../src/db/schema.js';
import {
  applySavedCredentials,
  type AppCredentialsConfig,
} from '../src/modules/app-credentials/service.js';
import { TEST_CIPHER, closeDatabase, withRollback } from './helpers/integration.js';

const ENV = parseEnv({
  API_TOKEN: 'x'.repeat(40),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  YOUTUBE_CLIENT_ID: 'yt-dal-env',
  YOUTUBE_CLIENT_SECRET: 'segreto-env',
});

function config(changes: string[]): AppCredentialsConfig {
  return {
    cipher: TEST_CIPHER,
    env: ENV,
    redirects: {
      linkedin: 'https://code965.github.io/Prisma/oauth/linkedin/',
      instagram: 'https://code965.github.io/Prisma/oauth/instagram/',
      youtube: 'http://127.0.0.1:47615/oauth/youtube/callback',
      tiktok: 'http://127.0.0.1:47615/oauth/tiktok/callback',
    },
    onChanged: () => changes.push('cambiate'),
  };
}

describe('credenziali delle app (SQLite)', () => {
  afterAll(closeDatabase);

  it('salva cifrato, non restituisce il segreto e tiene quello vecchio solo per la stessa app', async () => {
    const changes: string[] = [];
    await withRollback(
      async (ctx) => {
        const list = (await ctx.call({ method: 'GET', url: '/settings/apps' })).json<
          AppCredentialView[]
        >();
        expect(list.map((item) => `${item.key}:${item.source}`)).toEqual([
          'linkedin:nessuna',
          'instagram:nessuna',
          'youtube:env',
          'tiktok:nessuna',
          'r2:nessuna',
        ]);
        expect(list[0]!.redirectUri).toBe('https://code965.github.io/Prisma/oauth/linkedin/');

        const missing = await ctx.call({
          method: 'PUT',
          url: '/settings/apps/linkedin',
          payload: { clientId: '86abc' },
        });
        expect(missing.statusCode).toBe(422);

        const saved = await ctx.call({
          method: 'PUT',
          url: '/settings/apps/linkedin',
          payload: { clientId: ' 86abc ', clientSecret: 'super-segreto' },
        });
        expect(saved.json()).toMatchObject({
          source: 'impostazioni',
          publicId: '86abc',
          hasSecret: true,
        });
        expect(saved.body).not.toContain('super-segreto');
        const [row] = await ctx.tx
          .select()
          .from(appCredentials)
          .where(eq(appCredentials.key, 'linkedin'));
        expect(
          JSON.parse(TEST_CIPHER.decrypt(row!.dataEnc, tokenContext('app', 'linkedin'))),
        ).toEqual({ clientId: '86abc', clientSecret: 'super-segreto' });

        // Stessa app senza segreto: si tiene; un'altra app senza segreto: no.
        const kept = await ctx.call({
          method: 'PUT',
          url: '/settings/apps/linkedin',
          payload: { clientId: '86abc' },
        });
        expect(kept.json()).toMatchObject({ hasSecret: true });
        const other = await ctx.call({
          method: 'PUT',
          url: '/settings/apps/linkedin',
          payload: { clientId: 'altra-app' },
        });
        expect(other.statusCode).toBe(422);
        expect(changes).toHaveLength(2);

        const removed = await ctx.call({ method: 'DELETE', url: '/settings/apps/linkedin' });
        expect(removed.json()).toMatchObject({ source: 'nessuna' });
      },
      { appCredentials: config(changes) },
    );
  });

  it('R2: controlla Account ID e indirizzi', async () => {
    await withRollback(
      async (ctx) => {
        const bad = await ctx.call({
          method: 'PUT',
          url: '/settings/apps/r2',
          payload: { accountId: 'abc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'prisma' },
        });
        expect(bad.statusCode).toBe(400);
        const good = await ctx.call({
          method: 'PUT',
          url: '/settings/apps/r2',
          payload: {
            accountId: 'a'.repeat(32),
            accessKeyId: 'chiave',
            secretAccessKey: 'segreta',
            bucket: 'prisma-media',
            publicBaseUrl: 'https://pub-123.r2.dev/',
          },
        });
        expect(good.json()).toMatchObject({
          publicId: 'chiave',
          r2: { bucket: 'prisma-media', publicBaseUrl: 'https://pub-123.r2.dev' },
        });
      },
      { appCredentials: config([]) },
    );
  });

  it('le credenziali salvate vincono sul .env', () => {
    const env = applySavedCredentials(ENV, {
      youtube: { clientId: 'yt-salvato', clientSecret: 's' },
    });
    expect(env.YOUTUBE_CLIENT_ID).toBe('yt-salvato');
    expect(env.LINKEDIN_CLIENT_ID).toBeUndefined();
  });
});
