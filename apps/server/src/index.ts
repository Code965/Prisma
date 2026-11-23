import { sql } from 'drizzle-orm';
import { buildApp } from './app.js';
import { loadDotEnv, parseEnv } from './config/env.js';
import { createTokenCipher } from './crypto/token-cipher.js';
import { createDatabase } from './db/client.js';
import { createPublisherRegistry } from './publishers/types.js';
import { createScheduler } from './scheduler/worker.js';
import { createMetricsCollector } from './modules/analytics/collector.js';
import { createServices } from './services.js';
import { createLlmProvider } from './llm/factory.js';
import { createBlogAdapter } from './publishers/blog/adapter.js';
import { createBlogClient } from './publishers/blog/client.js';
import { createLinkedInAdapter } from './publishers/linkedin/adapter.js';
import { createLinkedInClient } from './publishers/linkedin/client.js';
import {
  instagramOAuthConfig,
  linkedinOAuthConfig,
  tiktokOAuthConfig,
  youtubeOAuthConfig,
} from './modules/oauth/config.js';
import { tiktokTokenRefresher } from './modules/oauth/tiktok-service.js';
import { createTikTokAdapter } from './publishers/tiktok/adapter.js';
import { createTikTokClient } from './publishers/tiktok/client.js';
import { youtubeTokenRefresher } from './modules/oauth/youtube-service.js';
import { updateAccountTokens } from './modules/social-accounts/repository.js';
import { createAccessTokenResolver } from './modules/social-accounts/tokens.js';
import { createYouTubeAdapter } from './publishers/youtube/adapter.js';
import { createYouTubeClient } from './publishers/youtube/client.js';
import { createInstagramAdapter } from './publishers/instagram/adapter.js';
import { createInstagramClient } from './publishers/instagram/client.js';
import { createR2Storage, r2ConfigFromEnv } from './storage/r2.js';

async function main(): Promise<void> {
  loadDotEnv();
  const env = parseEnv(process.env);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEY);
  const linkedinClient = createLinkedInClient({ apiVersion: env.LINKEDIN_API_VERSION });
  const instagramClient = createInstagramClient({ apiVersion: env.INSTAGRAM_API_VERSION });
  // R2 per i file da pubblicare (caroselli); senza credenziali il caricamento risponde 503.
  const r2 = r2ConfigFromEnv(env);
  const storage = r2 ? createR2Storage(r2) : null;
  const youtubeClient = createYouTubeClient();
  const youtubeOAuth = youtubeOAuthConfig(env, youtubeClient, cipher);
  const tiktokClient = createTikTokClient();
  const tiktokOAuth = tiktokOAuthConfig(env, tiktokClient, cipher);
  // Token di accesso: per YouTube se ne chiede uno nuovo a ogni uso con il refresh token.
  const accessToken = createAccessTokenResolver(
    cipher,
    {
      ...(youtubeOAuth ? { youtube: youtubeTokenRefresher(youtubeOAuth) } : {}),
      ...(tiktokOAuth ? { tiktok: tiktokTokenRefresher(tiktokOAuth) } : {}),
    },
    { persist: (accountId, values) => updateAccountTokens(db, accountId, values) },
  );
  // Adapter delle piattaforme: le pubblicazioni di piattaforme senza adapter restano
  // `programmato` e lo scheduler non le tocca.
  const blogClient = createBlogClient();
  const publishers = createPublisherRegistry([
    createLinkedInAdapter(linkedinClient, {
      readObject: storage ? (key) => storage.read(key) : null,
    }),
    createInstagramAdapter(instagramClient),
    createBlogAdapter(blogClient),
    createYouTubeAdapter(youtubeClient, {
      openObject: storage ? (key, start) => storage.readStream(key, start) : null,
      categoryId: env.YOUTUBE_CATEGORY_ID,
    }),
    createTikTokAdapter(tiktokClient, {
      openRange: storage ? (key, start, end) => storage.readStream(key, start, end) : null,
    }),
  ]);

  const services = createServices(db, {
    llm: createLlmProvider(env),
    linkedinOAuth: linkedinOAuthConfig(env, linkedinClient, cipher),
    instagramOAuth: instagramOAuthConfig(env, instagramClient, cipher),
    youtubeOAuth,
    tiktokOAuth,
    accessToken,
    publishers,
    blogConnection: { client: blogClient, cipher },
    storage,
  });

  const app = await buildApp(
    {
      apiToken: env.API_TOKEN,
      checkDatabase: async () => {
        await db.execute(sql`SELECT 1`);
      },
      services,
    },
    { logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } },
  );

  const scheduler = createScheduler({
    db,
    publishers,
    cipher,
    accessToken,
    loadMedia: services.assets.list,
    logger: app.log,
  });

  const collector = createMetricsCollector({ db, publishers, accessToken, logger: app.log });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Arresto in corso');
    collector.stop();
    await scheduler.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // Rinnovo dei token Instagram (60 giorni) prima della scadenza: all'avvio e ogni 6 ore.
  const refreshInstagram = () =>
    services.instagramOAuth
      .refreshExpiring()
      .then((result) => {
        if (result.refreshed || result.failed) app.log.info(result, 'Rinnovo token Instagram');
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'Rinnovo token Instagram fallito'));
  const refreshTimer = setInterval(() => void refreshInstagram(), 6 * 60 * 60_000);
  refreshTimer.unref();
  void refreshInstagram();

  await app.listen({ port: env.PORT, host: env.HOST });
  if (env.SCHEDULER_ENABLED) scheduler.start(env.SCHEDULER_POLL_MS);
  if (env.ANALYTICS_ENABLED) {
    collector.start(env.ANALYTICS_POLL_MS);
    // Suggerimenti dell'AI: generati una volta a settimana, controllando a ogni giro orario.
    const refreshInsights = () =>
      services.insights
        .refreshDue((brandId, error) =>
          app.log.warn({ brandId, err: error }, 'Suggerimenti dell’AI non generati'),
        )
        .then((count) => count && app.log.info({ count }, 'Suggerimenti dell’AI generati'))
        .catch((error: unknown) => app.log.error({ err: error }, 'Giro dei suggerimenti fallito'));
    const insightsTimer = setInterval(() => void refreshInsights(), env.ANALYTICS_POLL_MS);
    insightsTimer.unref();
    setTimeout(() => void refreshInsights(), 60_000).unref();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
