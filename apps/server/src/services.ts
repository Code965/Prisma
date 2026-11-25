import type { DbExecutor } from './db/executor.js';
import type { PublisherRegistry } from './publishers/types.js';
import { createPromptLibrary, type PromptLibrary } from './llm/prompts.js';
import { isLlmSource, staticLlmSource, type LlmProvider, type LlmSource } from './llm/types.js';
import { createCarouselAiService } from './modules/ai/carousel.js';
import { createAiService } from './modules/ai/service.js';
import { createShortsAiService } from './modules/ai/shorts.js';
import {
  createBlogConnectionService,
  type BlogConnectionConfig,
} from './modules/blog-connection/service.js';
import { createInsightsService } from './modules/analytics/insights.js';
import { publishedPostsForBrand } from './modules/analytics/repository.js';
import { createAnalyticsService } from './modules/analytics/service.js';
import { createAssetService } from './modules/assets/service.js';
import {
  createInstagramOAuthService,
  type InstagramOAuthConfig,
} from './modules/oauth/instagram-service.js';
import type { ObjectStorage } from './storage/types.js';
import { createBrandKitService } from './modules/brand-kit/service.js';
import { createBrandService } from './modules/brands/service.js';
import { createContentService } from './modules/contents/service.js';
import { createIdeaService } from './modules/ideas/service.js';
import {
  createLinkedInOAuthService,
  type LinkedInOAuthConfig,
} from './modules/oauth/linkedin-service.js';
import { createPublicationService } from './modules/publications/service.js';
import {
  createYouTubeOAuthService,
  type YouTubeOAuthConfig,
} from './modules/oauth/youtube-service.js';
import type { AccessTokenResolver } from './modules/social-accounts/tokens.js';
import {
  createTikTokOAuthService,
  type TikTokOAuthConfig,
} from './modules/oauth/tiktok-service.js';
import { createSocialAccountService } from './modules/social-accounts/service.js';
import { createTagService } from './modules/tags/service.js';
import { createVideoScriptService } from './modules/ai/video-script.js';
import { createStockService, type StockConfig } from './modules/stock/service.js';
import { createEnrichService } from './modules/ai/enrich.js';
import { createAutoEditService } from './modules/ai/auto-edit.js';
import { createAiSettingsService, type AiSettingsConfig } from './modules/ai-settings/service.js';
import {
  createAppCredentialsService,
  type AppCredentialsConfig,
} from './modules/app-credentials/service.js';
import { createVariantService } from './modules/variants/service.js';

export interface ServiceOptions {
  now?: () => Date;
  /**
   * Provider dell'AI: fisso (test) o letto dalle impostazioni a ogni operazione. Senza provider
   * le rotte AI rispondono 503.
   */
  llm?: LlmProvider | LlmSource | null;
  /**
   * Impostazioni dell'AI scelte dall'utente (cifratura e ripiego del .env). Se ci sono, l'AI in
   * uso è quella delle Impostazioni e `llm` non serve; assenti → le rotte /ai/settings danno 503.
   */
  aiSettings?: AiSettingsConfig | null;
  /** Credenziali delle app delle piattaforme e di R2 (Impostazioni › Account); assenti → 503. */
  appCredentials?: AppCredentialsConfig | null;
  /** Archivio di B-roll (Pixabay): cifratura della chiave; assente → 503. */
  stock?: StockConfig | null;
  prompts?: PromptLibrary;
  /** Assente senza credenziali LinkedIn: il collegamento dell'account risponde 503. */
  linkedinOAuth?: LinkedInOAuthConfig | null;
  /** Adapter delle piattaforme, condivisi con lo scheduler (servono ai controlli della coda). */
  publishers?: PublisherRegistry;
  /** Client del sito e cifratura per il collegamento al blog; assente → 503. */
  blogConnection?: BlogConnectionConfig | null;
  /** App Instagram per il collegamento degli account; assente → 503. */
  instagramOAuth?: InstagramOAuthConfig | null;
  /** Cloudflare R2 per i file da pubblicare; assente → 503 sul caricamento. */
  storage?: ObjectStorage | null;
  /** App Google per il collegamento del canale YouTube; assente → 503. */
  youtubeOAuth?: YouTubeOAuthConfig | null;
  /** App TikTok (Login Kit + Content Posting API) per il collegamento; assente → 503. */
  tiktokOAuth?: TikTokOAuthConfig | null;
  /** Token di accesso per Annulla/Sposta dei video già caricati (YouTube). */
  accessToken?: AccessTokenResolver | null;
}

/** Composizione dei servizi: il punto in cui si decide quale DB, orologio, LLM e OAuth usare. */
export function createServices(db: DbExecutor, options: ServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const brands = createBrandService(db);
  const brandKit = createBrandKitService(db, brands);
  const assets = createAssetService(db, brands, brandKit, options.storage ?? null, now);
  const tags = createTagService(db, brands);
  const ideas = createIdeaService(db, brands, tags);
  const accounts = createSocialAccountService(db, brands, now);
  const contents = createContentService(db, brands, ideas);
  const aiSettings = createAiSettingsService({ db, config: options.aiSettings ?? null });
  const llm: LlmSource = options.aiSettings
    ? aiSettings.source
    : options.llm && isLlmSource(options.llm)
      ? options.llm
      : staticLlmSource(options.llm ?? null);
  const prompts = options.prompts ?? createPromptLibrary();
  const analytics = createAnalyticsService(db, brands, now);
  return {
    brands,
    brandKit,
    assets,
    tags,
    ideas,
    accounts,
    contents,
    variants: createVariantService(db, now),
    analytics,
    aiSettings,
    appCredentials: createAppCredentialsService({ db, config: options.appCredentials ?? null }),
    stock: createStockService({ db, config: options.stock ?? null }),
    insights: createInsightsService({
      db,
      llm,
      prompts,
      brands,
      now,
      data: async (brandId) => {
        const [report, slots, posts] = await Promise.all([
          analytics.report(brandId, '8w'),
          analytics.slots(brandId),
          publishedPostsForBrand(db, brandId, new Date(now().getTime() - 56 * 86_400_000)),
        ]);
        return { report, posts, slots: slots.platforms };
      },
    }),
    publications: createPublicationService(
      db,
      accounts,
      now,
      options.publishers,
      assets.list,
      options.accessToken ?? null,
    ),
    ai: createAiService({
      db,
      now,
      llm,
      prompts,
      brands,
      ideas,
      contents,
      voice: brandKit.voicePrompt,
    }),
    carouselAi: createCarouselAiService({
      db,
      now,
      llm,
      prompts,
      brands,
      voice: brandKit.voicePrompt,
      defaultTemplate: async (brandId) => (await brandKit.getKit(brandId)).carouselTemplate,
    }),
    shortsAi: createShortsAiService({
      db,
      llm,
      prompts,
      brands,
      contents,
      voice: brandKit.voicePrompt,
    }),
    autoEdit: createAutoEditService({ llm, prompts, brands, voice: brandKit.voicePrompt }),
    enrich: createEnrichService({ llm, prompts, brands, voice: brandKit.voicePrompt }),
    videoScript: createVideoScriptService({
      db,
      llm,
      prompts,
      brands,
      ideas,
      voice: brandKit.voicePrompt,
    }),
    blogConnection: createBlogConnectionService({
      db,
      config: options.blogConnection ?? null,
      brands,
      accounts,
    }),
    tiktokOAuth: createTikTokOAuthService({
      db,
      config: options.tiktokOAuth ?? null,
      brands,
      accounts,
      now,
    }),
    youtubeOAuth: createYouTubeOAuthService({
      db,
      config: options.youtubeOAuth ?? null,
      brands,
      accounts,
      now,
    }),
    instagramOAuth: createInstagramOAuthService({
      db,
      config: options.instagramOAuth ?? null,
      brands,
      accounts,
      now,
    }),
    linkedinOAuth: createLinkedInOAuthService({
      db,
      config: options.linkedinOAuth ?? null,
      brands,
      accounts,
      now,
    }),
  };
}

export type Services = ReturnType<typeof createServices>;
