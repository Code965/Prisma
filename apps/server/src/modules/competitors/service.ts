import {
  COMPETITOR_MAX,
  COMPETITOR_PLATFORMS,
  COMPETITOR_REFRESH_COOLDOWN_MS,
  COMPETITOR_WINDOW_DAYS,
  CompetitorInputSchema,
  CompetitorPostInputSchema,
  type Competitor,
  type CompetitorAnalysis,
  type CompetitorPost,
  type CompetitorsState,
} from '@prisma-app/shared';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { competitorAnalyses, competitorPosts, competitors } from '../../db/schema.js';
import { BusinessRuleError, NotFoundError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import { accountDaysForBrand, publishedPostsForBrand } from '../analytics/repository.js';
import type { BrandService } from '../brands/service.js';
import { SourceError } from '../trends/sources.js';
import {
  competitorAnalysisSchema,
  formatAnalysisPosts,
  MIN_ANALYSIS_POSTS,
  selectAnalysisPosts,
  toAnalysis,
  type AnalysisPost,
} from './analysis.js';
import { engagementBasis, interactions, profileStats, type StatPost } from './stats.js';
import { fetchChannel, fetchRecentVideos, videoFormat } from './youtube.js';

const DAY = 86_400_000;
/** Il giro automatico aggiorna un canale YouTube se l'ultima lettura ha almeno 20 ore. */
export const COMPETITOR_AUTO_INTERVAL_MS = 20 * 60 * 60_000;

export interface CompetitorsConfig {
  fetch?: typeof fetch;
}

interface CompetitorsDeps {
  db: DbExecutor;
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  now: () => Date;
  /** Token OAuth dell'account YouTube collegato al brand; null se non c'è. */
  youtubeToken: (brandId: number) => Promise<string | null>;
  config?: CompetitorsConfig | null;
}

type CompetitorRow = typeof competitors.$inferSelect;
type PostRow = typeof competitorPosts.$inferSelect;

function toPost(row: PostRow): CompetitorPost {
  return {
    id: row.id,
    competitorId: row.competitorId,
    externalId: row.externalId,
    title: row.title,
    text: row.text,
    url: row.url,
    publishedAt: toIso(row.publishedAt),
    format: row.format,
    durationSec: row.durationSec,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    views: row.views,
    followers: row.followers,
    source: row.source,
  };
}

function statPost(row: PostRow): StatPost {
  return {
    postId: row.id,
    title: row.title ?? row.text?.slice(0, 120) ?? '',
    url: row.url,
    publishedAt: row.publishedAt,
    format: row.format,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    views: row.views,
    followers: row.followers,
  };
}

/**
 * Concorrenti (fase 8b): profili seguiti dal brand, post letti da YouTube o inseriti a mano,
 * statistiche pure confrontabili con le proprie e una chiamata LLM sui post migliori.
 */
export function createCompetitorsService(deps: CompetitorsDeps) {
  const { db, brands, now, prompts } = deps;
  const fetchFn = deps.config?.fetch ?? fetch;
  /** Ultimo tentativo automatico per concorrente: un errore non si ripete a ogni giro. */
  const attempted = new Map<number, number>();

  async function row(id: number): Promise<CompetitorRow> {
    const [found] = await db.select().from(competitors).where(eq(competitors.id, id));
    if (!found) throw new NotFoundError('Concorrente', id);
    return found;
  }

  async function postsOf(ids: number[]): Promise<PostRow[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(competitorPosts)
      .where(
        and(
          inArray(competitorPosts.competitorId, ids),
          gte(
            competitorPosts.publishedAt,
            new Date(now().getTime() - COMPETITOR_WINDOW_DAYS * DAY),
          ),
        ),
      )
      .orderBy(desc(competitorPosts.publishedAt));
  }

  async function list(brandId: number): Promise<Competitor[]> {
    const rows = await db
      .select()
      .from(competitors)
      .where(eq(competitors.brandId, brandId))
      .orderBy(asc(competitors.createdAt), asc(competitors.id));
    const posts = await postsOf(rows.map((r) => r.id));
    return rows.map((r) => {
      const own = posts.filter((p) => p.competitorId === r.id);
      return {
        id: r.id,
        brandId: r.brandId,
        name: r.name,
        platform: r.platform,
        handle: r.handle,
        url: r.url,
        notes: r.notes,
        externalId: r.externalId,
        followers: r.followers,
        lastFetchedAt: r.lastFetchedAt ? toIso(r.lastFetchedAt) : null,
        lastError: r.lastError,
        createdAt: toIso(r.createdAt),
        posts: own.map(toPost),
        stats: profileStats(own.map(statPost), r.followers, now()),
      };
    });
  }

  /** Le stesse statistiche sui post pubblicati dal brand, con i follower dell'ultimo giorno. */
  async function ownStats(brandId: number): Promise<CompetitorsState['own']> {
    const at = now();
    const since = new Date(at.getTime() - COMPETITOR_WINDOW_DAYS * DAY);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const [posts, days] = await Promise.all([
      publishedPostsForBrand(db, brandId, since),
      accountDaysForBrand(db, brandId, day(new Date(at.getTime() - 14 * DAY)), day(at)),
    ]);
    const result: CompetitorsState['own'] = [];
    for (const platform of COMPETITOR_PLATFORMS) {
      const mine = posts.filter((p) => p.platform === platform && p.metrics);
      if (mine.length === 0) continue;
      const followers =
        days
          .filter((d) => d.platform === platform && d.followers !== null)
          .sort((a, b) => b.day.localeCompare(a.day))[0]?.followers ?? null;
      const stat: StatPost[] = mine.map((p) => ({
        postId: null,
        title: p.title,
        url: p.externalUrl,
        publishedAt: p.publishedAt,
        format: p.format,
        likes: p.metrics!.likes,
        comments: p.metrics!.comments,
        shares: p.metrics!.shares,
        views: p.metrics!.views ?? p.metrics!.impressions,
        followers: null,
      }));
      result.push({ platform, stats: profileStats(stat, followers, at) });
    }
    return result;
  }

  async function analysis(brandId: number): Promise<CompetitorAnalysis | null> {
    const [found] = await db
      .select()
      .from(competitorAnalyses)
      .where(eq(competitorAnalyses.brandId, brandId));
    return found
      ? { ...found.analysis, model: found.model, createdAt: toIso(found.createdAt) }
      : null;
  }

  function analysisPosts(list: Competitor[]): AnalysisPost[] {
    return selectAnalysisPosts(
      list.map((c) => {
        const stats = c.posts.map((p) => ({ ...statPost(rowFromPost(p)), text: p.text }));
        const basis = engagementBasis(stats, c.stats.followers);
        return stats.map((p) => {
          const total = interactions(p);
          const base = basis === 'visualizzazioni' ? p.views : (p.followers ?? c.stats.followers);
          return {
            ...p,
            postId: p.postId!,
            competitor: c.name,
            platform: c.platform,
            rate: basis && total !== null && base ? total / base : null,
          };
        });
      }),
    );
  }

  /** Legge canale e ultimi video di un concorrente YouTube e li salva. */
  async function syncYouTube(competitor: CompetitorRow): Promise<void> {
    const token = await deps.youtubeToken(competitor.brandId);
    if (!token) throw new SourceError('Collega un account YouTube per leggere i canali');
    const channel = await fetchChannel(fetchFn, token, competitor.externalId ?? competitor.handle);
    const videos = await fetchRecentVideos(fetchFn, token, channel.uploadsId);
    const at = now();
    for (const video of videos) {
      const values = {
        title: video.title,
        text: video.description,
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        publishedAt: video.publishedAt,
        format: videoFormat(video.durationSec),
        durationSec: video.durationSec,
        likes: video.likes,
        comments: video.comments,
        views: video.views,
        followers: channel.subscribers,
      };
      await db
        .insert(competitorPosts)
        .values({
          competitorId: competitor.id,
          externalId: video.videoId,
          source: 'api',
          ...values,
        })
        .onConflictDoUpdate({
          target: [competitorPosts.competitorId, competitorPosts.externalId],
          set: { ...values, updatedAt: at },
        });
    }
    await db
      .update(competitors)
      .set({
        externalId: channel.channelId,
        uploadsId: channel.uploadsId,
        followers: channel.subscribers,
        url: competitor.url ?? `https://www.youtube.com/channel/${channel.channelId}`,
        lastFetchedAt: at,
        lastError: null,
        updatedAt: at,
      })
      .where(eq(competitors.id, competitor.id));
  }

  async function syncSafely(competitor: CompetitorRow): Promise<void> {
    try {
      await syncYouTube(competitor);
    } catch (error) {
      const message = error instanceof SourceError ? error.message : 'Errore inatteso';
      await db
        .update(competitors)
        .set({ lastError: message, updatedAt: now() })
        .where(eq(competitors.id, competitor.id));
      if (!(error instanceof SourceError)) throw error;
    }
  }

  async function single(id: number): Promise<Competitor> {
    const found = await row(id);
    return (await list(found.brandId)).find((c) => c.id === id)!;
  }

  /** Un post salvato con il suo concorrente e il tasso confrontato con la mediana del profilo. */
  async function postWithStats(postId: number) {
    const [post] = await db.select().from(competitorPosts).where(eq(competitorPosts.id, postId));
    if (!post) throw new NotFoundError('Post del concorrente', postId);
    const competitor = await single(post.competitorId);
    const stat = statPost(post);
    const basis = competitor.stats.basis;
    const total = interactions(stat);
    const base =
      basis === 'visualizzazioni' ? stat.views : (stat.followers ?? competitor.stats.followers);
    return {
      competitor,
      post: toPost(post),
      basis,
      rate: basis && total !== null && base ? total / base : null,
      medianRate: competitor.stats.medianRate,
    };
  }

  return {
    postWithStats,
    async state(brandId: number): Promise<CompetitorsState> {
      await brands.ensureExists(brandId);
      const [all, own, saved, llm] = await Promise.all([
        list(brandId),
        ownStats(brandId),
        analysis(brandId),
        deps.llm.current(),
      ]);
      const usable = analysisPosts(all).length;
      return {
        competitors: all,
        own,
        analysis: saved,
        analysisBlocked: !llm
          ? 'AI non configurata: scegli il servizio in Impostazioni › AI'
          : usable < MIN_ANALYSIS_POSTS
            ? `Servono almeno ${MIN_ANALYSIS_POSTS} post dei concorrenti con dei numeri`
            : null,
      };
    },

    /**
     * Aggiunge un concorrente. Su YouTube prima cerca il canale: uno che non esiste → 422 e nulla
     * si salva; senza account collegato si salva con l'errore e si aggiunge a mano.
     */
    async create(brandId: number, input: unknown): Promise<Competitor> {
      await brands.ensureExists(brandId);
      const data = CompetitorInputSchema.parse(input);
      const existing = await db
        .select({ id: competitors.id, platform: competitors.platform, handle: competitors.handle })
        .from(competitors)
        .where(eq(competitors.brandId, brandId));
      if (existing.length >= COMPETITOR_MAX) {
        throw new BusinessRuleError(`Al massimo ${COMPETITOR_MAX} concorrenti`);
      }
      const key = (h: string) => h.trim().replace(/^@/, '').toLowerCase();
      if (
        existing.some((c) => c.platform === data.platform && key(c.handle) === key(data.handle))
      ) {
        throw new BusinessRuleError('Concorrente già presente');
      }
      let channel: Awaited<ReturnType<typeof fetchChannel>> | null = null;
      let lastError: string | null = null;
      if (data.platform === 'youtube') {
        const token = await deps.youtubeToken(brandId);
        if (token) {
          try {
            channel = await fetchChannel(fetchFn, token, data.handle);
          } catch (error) {
            if (error instanceof SourceError) throw new BusinessRuleError(error.message);
            throw error;
          }
        } else {
          lastError = 'Collega un account YouTube per leggere i canali';
        }
      }
      const [created] = await db
        .insert(competitors)
        .values({
          brandId,
          name: data.name,
          platform: data.platform,
          handle: channel?.handle ?? data.handle,
          url: data.url ?? null,
          notes: data.notes || null,
          externalId: channel?.channelId ?? null,
          uploadsId: channel?.uploadsId ?? null,
          followers: channel?.subscribers ?? null,
          lastError,
        })
        .returning();
      if (channel) await syncSafely(created!);
      return single(created!.id);
    },

    async remove(id: number): Promise<void> {
      await row(id);
      await db.delete(competitors).where(eq(competitors.id, id));
    },

    async addPost(competitorId: number, input: unknown): Promise<CompetitorPost> {
      const competitor = await row(competitorId);
      const data = CompetitorPostInputSchema.parse(input);
      if (new Date(data.publishedAt).getTime() > now().getTime()) {
        throw new BusinessRuleError('La data del post è nel futuro');
      }
      const [created] = await db
        .insert(competitorPosts)
        .values({
          competitorId,
          externalId: null,
          title: data.title || null,
          text: data.text || null,
          url: data.url,
          publishedAt: new Date(data.publishedAt),
          format: data.format,
          likes: data.likes ?? null,
          comments: data.comments ?? null,
          shares: data.shares ?? null,
          views: data.views ?? null,
          followers: data.followers ?? null,
          source: 'manuale',
        })
        .returning();
      if (
        data.followers !== null &&
        data.followers !== undefined &&
        competitor.platform !== 'youtube'
      ) {
        await db
          .update(competitors)
          .set({ followers: data.followers, updatedAt: now() })
          .where(eq(competitors.id, competitorId));
      }
      return toPost(created!);
    },

    /** Solo i post inseriti a mano: quelli di YouTube tornerebbero al giro dopo. */
    async removePost(postId: number): Promise<void> {
      const [post] = await db
        .select({ source: competitorPosts.source })
        .from(competitorPosts)
        .where(eq(competitorPosts.id, postId));
      if (!post) throw new NotFoundError('Post', postId);
      if (post.source !== 'manuale') {
        throw new BusinessRuleError('I post letti da YouTube si aggiornano da soli');
      }
      await db.delete(competitorPosts).where(eq(competitorPosts.id, postId));
    },

    /** «Aggiorna» su un canale YouTube (al massimo ogni 15 minuti). */
    async refresh(id: number): Promise<Competitor> {
      const competitor = await row(id);
      if (competitor.platform !== 'youtube') {
        throw new BusinessRuleError('Solo i canali YouTube si aggiornano da soli');
      }
      const last = competitor.lastFetchedAt?.getTime() ?? 0;
      if (now().getTime() - last < COMPETITOR_REFRESH_COOLDOWN_MS) {
        throw new BusinessRuleError('Canale appena aggiornato: riprova tra qualche minuto');
      }
      try {
        await syncYouTube(competitor);
      } catch (error) {
        if (error instanceof SourceError) {
          await db
            .update(competitors)
            .set({ lastError: error.message, updatedAt: now() })
            .where(eq(competitors.id, id));
          throw new BusinessRuleError(error.message);
        }
        throw error;
      }
      return single(id);
    },

    /** Analisi dell'AI dei post migliori; sostituisce la precedente. */
    async analyze(brandId: number): Promise<CompetitorAnalysis> {
      const brand = await brands.get(brandId);
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const posts = analysisPosts(await list(brandId));
      if (posts.length < MIN_ANALYSIS_POSTS) {
        throw new BusinessRuleError(
          `Servono almeno ${MIN_ANALYSIS_POSTS} post dei concorrenti con dei numeri`,
        );
      }
      const generated = await llm.completeJson({
        schema: competitorAnalysisSchema(posts.length),
        messages: [
          {
            role: 'system',
            content: prompts.render('generate-competitors.system', { brandName: brand.name }),
          },
          {
            role: 'user',
            content: prompts.render('generate-competitors.user', {
              posts: formatAnalysisPosts(posts),
            }),
          },
        ],
      });
      const result = toAnalysis(generated, posts);
      const createdAt = now();
      await db
        .insert(competitorAnalyses)
        .values({ brandId, model: llm.name, analysis: result, createdAt })
        .onConflictDoUpdate({
          target: competitorAnalyses.brandId,
          set: { model: llm.name, analysis: result, createdAt },
        });
      return { ...result, model: llm.name, createdAt: createdAt.toISOString() };
    },

    /** Giro orario: rilegge i canali YouTube con l'ultima lettura più vecchia di 20 ore. */
    async refreshDue(log?: (competitorId: number, error: unknown) => void): Promise<number> {
      const rows = await db.select().from(competitors).where(eq(competitors.platform, 'youtube'));
      let done = 0;
      for (const competitor of rows) {
        const at = now().getTime();
        const last = Math.max(
          competitor.lastFetchedAt?.getTime() ?? 0,
          attempted.get(competitor.id) ?? 0,
        );
        if (at - last < COMPETITOR_AUTO_INTERVAL_MS) continue;
        attempted.set(competitor.id, at);
        try {
          await syncSafely(competitor);
          done++;
        } catch (error) {
          log?.(competitor.id, error);
        }
      }
      return done;
    },
  };
}

/** Il DTO del post riportato alla forma della riga per le statistiche. */
function rowFromPost(post: CompetitorPost): PostRow {
  return {
    ...post,
    publishedAt: new Date(post.publishedAt),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export type CompetitorsService = ReturnType<typeof createCompetitorsService>;
