import type { AiSettingsConfig } from '../../src/modules/ai-settings/service.js';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Platform } from '@prisma-app/shared';
import { buildApp } from '../../src/app.js';
import { randomBytes } from 'node:crypto';
import { createTokenCipher, tokenContext } from '../../src/crypto/token-cipher.js';
import { createDatabase, type Database } from '../../src/db/client.js';
import { applyMigrations } from '../../src/db/migrations.js';
import type { Transaction } from '../../src/db/executor.js';
import { brands, socialAccounts } from '../../src/db/schema.js';
import type { LlmProvider } from '../../src/llm/types.js';
import type { PublisherRegistry } from '../../src/publishers/types.js';
import type { ObjectStorage } from '../../src/storage/types.js';
import type { InstagramOAuthConfig } from '../../src/modules/oauth/instagram-service.js';
import type { YouTubeOAuthConfig } from '../../src/modules/oauth/youtube-service.js';
import type { TikTokOAuthConfig } from '../../src/modules/oauth/tiktok-service.js';
import type { AccessTokenResolver } from '../../src/modules/social-accounts/tokens.js';
import type { BlogConnectionConfig } from '../../src/modules/blog-connection/service.js';
import type { LinkedInOAuthConfig } from '../../src/modules/oauth/linkedin-service.js';
import { createServices } from '../../src/services.js';

/**
 * I test di integrazione usano un database SQLite in memoria, uno per file di test, con le
 * migrazioni vere: girano sempre, anche nella CI. (Il nome resta per i `describe.skipIf`.)
 */
export const databaseUrl = ':memory:';
export const TEST_TOKEN = 't'.repeat(64);
/** Orologio fisso: le date dei test non dipendono da quando girano. */
export const NOW = new Date('2026-11-21T12:00:00.000Z');

class Rollback extends Error {}

export interface TestContext {
  tx: Transaction;
  call: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  /** Come `call` ma senza token API, come farebbe un browser. */
  callAnonymous: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  createBrand: () => Promise<number>;
  /** Il token è cifrato con `TEST_CIPHER` e il contesto `accountExternalId(platform, brandId)`. */
  createAccount: (brandId: number, platform: Platform) => Promise<number>;
}

export const TEST_CIPHER = createTokenCipher(randomBytes(32).toString('base64'));
export const TEST_ACCESS_TOKEN = 'token-di-test';

export function accountExternalId(platform: Platform, brandId: number): string {
  return `ext-${platform}-${brandId}`;
}

let database: ReturnType<typeof createDatabase> | undefined;

export function getDatabase(): Database {
  if (!database) {
    database = createDatabase(':memory:');
    applyMigrations(database.sqlite);
  }
  return database.db;
}

export async function closeDatabase(): Promise<void> {
  database?.close();
  database = undefined;
}

/**
 * Esegue il test dentro una transazione che viene sempre annullata:
 * nessun dato resta nel database, anche se il test fallisce.
 */
export async function withRollback(
  test: (ctx: TestContext) => Promise<void>,
  options: {
    now?: Date;
    llm?: LlmProvider;
    linkedinOAuth?: LinkedInOAuthConfig;
    publishers?: PublisherRegistry;
    blogConnection?: BlogConnectionConfig;
    storage?: ObjectStorage;
    instagramOAuth?: InstagramOAuthConfig;
    youtubeOAuth?: YouTubeOAuthConfig;
    tiktokOAuth?: TikTokOAuthConfig;
    accessToken?: AccessTokenResolver;
    aiSettings?: AiSettingsConfig;
  } = {},
): Promise<void> {
  const now = options.now ?? NOW;
  try {
    await getDatabase().transaction(async (tx) => {
      const app: FastifyInstance = await buildApp({
        apiToken: TEST_TOKEN,
        checkDatabase: async () => {},
        services: createServices(tx, {
          now: () => now,
          llm: options.llm ?? null,
          linkedinOAuth: options.linkedinOAuth ?? null,
          publishers: options.publishers,
          blogConnection: options.blogConnection ?? null,
          storage: options.storage ?? null,
          instagramOAuth: options.instagramOAuth ?? null,
          youtubeOAuth: options.youtubeOAuth ?? null,
          tiktokOAuth: options.tiktokOAuth ?? null,
          accessToken: options.accessToken ?? null,
          aiSettings: options.aiSettings ?? null,
        }),
      });
      try {
        await test({
          tx,
          call: (options) =>
            app.inject({
              ...options,
              headers: { ...options.headers, authorization: `Bearer ${TEST_TOKEN}` },
            }),
          callAnonymous: (options) => app.inject(options),
          createBrand: async () => {
            const [row] = await tx
              .insert(brands)
              .values({ name: 'Brand di test', initials: 'BT' })
              .returning({ id: brands.id });
            return row!.id;
          },
          createAccount: async (brandId, platform) => {
            const externalId = accountExternalId(platform, brandId);
            const [row] = await tx
              .insert(socialAccounts)
              .values({
                brandId,
                platform,
                externalId,
                displayName: `Account ${platform}`,
                accessTokenEnc: TEST_CIPHER.encrypt(
                  TEST_ACCESS_TOKEN,
                  tokenContext(platform, externalId),
                ),
              })
              .returning({ id: socialAccounts.id });
            return row!.id;
          },
        });
      } finally {
        await app.close();
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
