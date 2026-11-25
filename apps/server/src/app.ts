import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { apiToken } from './auth/api-token.js';
import { errorHandler } from './http/error-handler.js';
import { brandRoutes } from './modules/brands/routes.js';
import { brandKitRoutes } from './modules/brand-kit/routes.js';
import { assetRoutes } from './modules/assets/routes.js';
import { contentRoutes } from './modules/contents/routes.js';
import { ideaRoutes } from './modules/ideas/routes.js';
import { publicationRoutes } from './modules/publications/routes.js';
import { socialAccountRoutes } from './modules/social-accounts/routes.js';
import { tagRoutes } from './modules/tags/routes.js';
import { variantRoutes } from './modules/variants/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { analyticsRoutes } from './modules/analytics/routes.js';
import { blogConnectionRoutes } from './modules/blog-connection/routes.js';
import { aiSettingsRoutes } from './modules/ai-settings/routes.js';
import { appCredentialsRoutes } from './modules/app-credentials/routes.js';
import { stockRoutes } from './modules/stock/routes.js';
import { OAUTH_CALLBACK_PATHS, oauthRoutes } from './modules/oauth/routes.js';
import type { Services } from './services.js';

export interface AppDependencies {
  apiToken: string;
  /** Verifica che il database risponda; lancia un errore se non è raggiungibile. */
  checkDatabase: () => Promise<void>;
  /** Servizi di dominio; se assenti si registrano solo le rotte di sistema. */
  services?: Services;
}

/** Raggiungibili senza token: health check e callback OAuth aperte dal browser. */
export const PUBLIC_PATHS = ['/health', ...OAUTH_CALLBACK_PATHS] as const;

export async function buildApp(
  deps: AppDependencies,
  options: FastifyServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify(options);

  app.setErrorHandler(errorHandler);
  await app.register(apiToken, { token: deps.apiToken, publicPaths: PUBLIC_PATHS });

  app.get('/health', async (_request, reply) => {
    try {
      await deps.checkDatabase();
      return { status: 'ok', database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degradato', database: 'non raggiungibile' });
    }
  });

  app.get('/me', async () => ({ authenticated: true }));

  if (deps.services) registerDomainRoutes(app, deps.services);

  return app;
}

function registerDomainRoutes(app: FastifyInstance, services: Services): void {
  brandRoutes(app, services.brands);
  brandKitRoutes(app, services.brandKit);
  assetRoutes(app, services.assets);
  tagRoutes(app, services.tags);
  ideaRoutes(app, services.ideas, services.contents);
  socialAccountRoutes(app, services.accounts);
  contentRoutes(app, services.contents);
  variantRoutes(app, services.variants);
  publicationRoutes(app, services.publications);
  analyticsRoutes(app, services.analytics, services.insights);
  aiRoutes(
    app,
    services.ai,
    services.carouselAi,
    services.shortsAi,
    services.autoEdit,
    services.videoScript,
    services.enrich,
  );
  oauthRoutes(app, {
    linkedin: services.linkedinOAuth,
    instagram: services.instagramOAuth,
    youtube: services.youtubeOAuth,
    tiktok: services.tiktokOAuth,
  });
  blogConnectionRoutes(app, services.blogConnection);
  aiSettingsRoutes(app, services.aiSettings);
  appCredentialsRoutes(app, services.appCredentials);
  stockRoutes(app, services.stock);
}
