import type { FastifyServerOptions } from 'fastify';
import { buildApp } from './app.js';
import type { Env } from './config/env.js';
import { createTokenCipher } from './crypto/token-cipher.js';
import { createDatabase } from './db/client.js';
import { applyMigrations } from './db/migrations.js';
import { ensureDefaults } from './db/seed.js';
import { envProviderConfig } from './llm/factory.js';
import { createMetricsCollector } from './modules/analytics/collector.js';
import {
  instagramOAuthConfig,
  linkedinOAuthConfig,
  tiktokOAuthConfig,
  youtubeOAuthConfig,
} from './modules/oauth/config.js';
import { tiktokTokenRefresher } from './modules/oauth/tiktok-service.js';
import { youtubeTokenRefresher } from './modules/oauth/youtube-service.js';
import { updateAccountTokens } from './modules/social-accounts/repository.js';
import { createAccessTokenResolver } from './modules/social-accounts/tokens.js';
import { createBlogAdapter } from './publishers/blog/adapter.js';
import { createBlogClient } from './publishers/blog/client.js';
import { createInstagramAdapter } from './publishers/instagram/adapter.js';
import { createInstagramClient } from './publishers/instagram/client.js';
import { createLinkedInAdapter } from './publishers/linkedin/adapter.js';
import { createLinkedInClient } from './publishers/linkedin/client.js';
import { createTikTokAdapter } from './publishers/tiktok/adapter.js';
import { createTikTokClient } from './publishers/tiktok/client.js';
import { createPublisherRegistry } from './publishers/types.js';
import { createYouTubeAdapter } from './publishers/youtube/adapter.js';
import { createYouTubeClient } from './publishers/youtube/client.js';
import { createScheduler } from './scheduler/worker.js';
import { applySavedCredentials, loadSavedCredentials } from './modules/app-credentials/service.js';
import { createServices } from './services.js';
import type { OAuthApp } from '@prisma-app/shared';
import { createR2Storage, r2ConfigFromEnv } from './storage/r2.js';

/**
 * Tutto Prisma lato server in un oggetto: database SQLite (con migrazioni e dati iniziali),
 * servizi, API Fastify, scheduler e raccolta delle metriche. Lo usano sia il server da solo
 * (`index.ts`, che apre la porta) sia l'app desktop, che lo fa girare nel processo principale
 * e gli passa le richieste con `app.inject`, senza aprire porte.
 */
export interface RuntimeOptions {
  logger?: FastifyServerOptions['logger'];
  /**
   * Indirizzi di ritorno del login per piattaforma (l'app desktop usa 127.0.0.1 e la pagina su
   * GitHub Pages); assenti → quelli del .env.
   */
  redirects?: Partial<Record<OAuthApp, string>>;
  /** Credenziali cambiate nelle Impostazioni: chi ospita il runtime lo ricostruisce. */
  onCredentialsChanged?: () => void;
}

export async function createPrismaRuntime(baseEnv: Env, options: RuntimeOptions = {}) {
  const database = createDatabase(baseEnv.DATABASE_PATH);
  applyMigrations(database.sqlite);
  const { db } = database;
  await ensureDefaults(db);

  const cipher = createTokenCipher(baseEnv.TOKEN_ENCRYPTION_KEY);
  const redirects: Record<OAuthApp, string> = {
    linkedin: options.redirects?.linkedin ?? baseEnv.LINKEDIN_REDIRECT_URI,
    instagram: options.redirects?.instagram ?? baseEnv.INSTAGRAM_REDIRECT_URI,
    youtube: options.redirects?.youtube ?? baseEnv.YOUTUBE_REDIRECT_URI,
    tiktok: options.redirects?.tiktok ?? baseEnv.TIKTOK_REDIRECT_URI,
  };
  // Le credenziali salvate nelle Impostazioni vincono sul .env.
  const env: Env = {
    ...applySavedCredentials(baseEnv, await loadSavedCredentials(db, cipher)),
    LINKEDIN_REDIRECT_URI: redirects.linkedin,
    INSTAGRAM_REDIRECT_URI: redirects.instagram,
    YOUTUBE_REDIRECT_URI: redirects.youtube,
    TIKTOK_REDIRECT_URI: redirects.tiktok,
  };
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
    aiSettings: { cipher, env: envProviderConfig(env), timeoutMs: env.DEEPSEEK_TIMEOUT_MS },
    stock: { cipher },
    appCredentials: {
      cipher,
      env: baseEnv,
      redirects,
      ...(options.onCredentialsChanged ? { onChanged: options.onCredentialsChanged } : {}),
    },
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
        database.sqlite.prepare('SELECT 1').get();
      },
      services,
    },
    { logger: options.logger ?? { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } },
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
  const timers: NodeJS.Timeout[] = [];

  /** Lavori periodici: scheduler, metriche, suggerimenti dell'AI, rinnovo dei token Instagram. */
  function startBackground(): void {
    // Rinnovo dei token Instagram (60 giorni) prima della scadenza: all'avvio e ogni 6 ore.
    const refreshInstagram = () =>
      services.instagramOAuth
        .refreshExpiring()
        .then((result) => {
          if (result.refreshed || result.failed) app.log.info(result, 'Rinnovo token Instagram');
        })
        .catch((error: unknown) =>
          app.log.error({ err: error }, 'Rinnovo token Instagram fallito'),
        );
    timers.push(setInterval(() => void refreshInstagram(), 6 * 60 * 60_000));
    void refreshInstagram();

    // Pulizia di R2 una volta al giorno (file di export superati da più di 7 giorni).
    if (storage) {
      const cleanup = () =>
        services.assets
          .cleanupStorage()
          .then((result) => result.deleted && app.log.info(result, 'Pulizia di R2'))
          .catch((error: unknown) => app.log.warn({ err: error }, 'Pulizia di R2 non riuscita'));
      timers.push(setInterval(() => void cleanup(), 24 * 60 * 60_000));
      timers.push(setTimeout(() => void cleanup(), 5 * 60_000));
    }

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
          .catch((error: unknown) =>
            app.log.error({ err: error }, 'Giro dei suggerimenti fallito'),
          );
      timers.push(setInterval(() => void refreshInsights(), env.ANALYTICS_POLL_MS));
      timers.push(setTimeout(() => void refreshInsights(), 60_000));
    }
    for (const timer of timers) timer.unref();
  }

  async function stop(): Promise<void> {
    for (const timer of timers) clearTimeout(timer);
    collector.stop();
    await scheduler.stop();
    await app.close();
    database.close();
  }

  return { app, services, startBackground, stop };
}

export type PrismaRuntime = Awaited<ReturnType<typeof createPrismaRuntime>>;
