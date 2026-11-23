import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPeriod,
  type AnalyticsReport,
  type ManualMetricsInput,
  type PublicationMetrics,
  type RecommendedSlots,
  type WeekSummary,
} from '@prisma-app/shared';
import type { BrandService } from '../brands/service.js';
import {
  addDays,
  periodBuckets,
  platformSeries,
  romeDay,
  topContents,
  weekSummary,
} from './aggregate.js';
import { recommendedSlots } from './slots.js';
import type { DbExecutor } from '../../db/executor.js';
import { BusinessRuleError, NotFoundError } from '../../http/error-handler.js';
import { findPublicationRow } from '../publications/repository.js';
import * as repo from './repository.js';

/** Metriche dei singoli post: ultima rilevazione e inserimento a mano (LinkedIn). */
export function createAnalyticsService(db: DbExecutor, brands: BrandService, now: () => Date) {
  return {
    /** Slot consigliati dai post degli ultimi 90 giorni (o quelli predefiniti, con pochi dati). */
    async slots(brandId: number): Promise<RecommendedSlots> {
      await brands.ensureExists(brandId);
      const since = new Date(now().getTime() - 90 * 86_400_000);
      return { platforms: recommendedSlots(await repo.publishedPostsForBrand(db, brandId, since)) };
    },

    /** Ultimi 7 giorni per la Dashboard (i giorni da due settimane prima, per i follower). */
    async summary(brandId: number): Promise<WeekSummary> {
      await brands.ensureExists(brandId);
      const at = now();
      const today = romeDay(at);
      const [days, posts] = await Promise.all([
        repo.accountDaysForBrand(db, brandId, addDays(today, -14), today),
        repo.publishedPostsForBrand(db, brandId, new Date(at.getTime() - 8 * 86_400_000)),
      ]);
      return { platforms: weekSummary(days, posts, at) };
    },

    /**
     * Report della schermata Analytics. I follower si calcolano anche dal totale del giorno prima
     * del periodo, quindi i giorni partono una settimana prima; i post LinkedIn da completare a
     * mano sono quelli degli ultimi 90 giorni, qualunque sia il periodo.
     */
    async report(brandId: number, period: AnalyticsPeriod): Promise<AnalyticsReport> {
      await brands.ensureExists(brandId);
      const at = now();
      const buckets = periodBuckets(period, at);
      const first = buckets[0]!.start;
      const last = buckets[buckets.length - 1]!.end;
      const baseline = new Date(Date.parse(`${first}T00:00:00Z`) - 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const ninetyDaysAgo = new Date(at.getTime() - 90 * 86_400_000);
      const since = new Date(
        Math.min(Date.parse(`${first}T00:00:00Z`) - 86_400_000, ninetyDaysAgo.getTime()),
      );
      const [days, allPosts] = await Promise.all([
        repo.accountDaysForBrand(db, brandId, baseline, last),
        repo.publishedPostsForBrand(db, brandId, since),
      ]);
      const posts = allPosts.filter((p) => {
        const day = romeDay(p.publishedAt);
        return day >= first && day < last;
      });
      return {
        period,
        buckets,
        platforms: ANALYTICS_PLATFORMS.map((platform) =>
          platformSeries(platform, days, posts, buckets),
        ),
        top: topContents(posts),
        manual: allPosts
          .filter((p) => p.platform === 'linkedin' && p.publishedAt >= ninetyDaysAgo)
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
          .map((p) => ({
            publicationId: p.publicationId,
            title: p.title,
            publishedAt: p.publishedAt.toISOString(),
            externalUrl: p.externalUrl,
            metrics: p.metrics,
          })),
        generatedAt: at.toISOString(),
      };
    },

    async latest(publicationId: number): Promise<PublicationMetrics | null> {
      if (!(await findPublicationRow(db, publicationId))) {
        throw new NotFoundError('Pubblicazione', publicationId);
      }
      return repo.latestSnapshot(db, publicationId);
    },

    /**
     * Valori letti dall'autore sulla piattaforma. Una nuova rilevazione, non una correzione: la
     * storia resta e vale la più recente.
     */
    async saveManual(
      publicationId: number,
      input: ManualMetricsInput,
    ): Promise<PublicationMetrics> {
      const row = await findPublicationRow(db, publicationId);
      if (!row) throw new NotFoundError('Pubblicazione', publicationId);
      if (row.status !== 'pubblicato') {
        throw new BusinessRuleError('Le metriche si inseriscono solo per i post pubblicati');
      }
      await repo.insertSnapshot(
        db,
        publicationId,
        {
          capturedAt: now(),
          impressions: input.impressions ?? undefined,
          reach: input.reach ?? undefined,
          likes: input.likes ?? undefined,
          comments: input.comments ?? undefined,
          shares: input.shares ?? undefined,
          saves: input.saves ?? undefined,
          raw: null,
        },
        'manuale',
      );
      return (await repo.latestSnapshot(db, publicationId))!;
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
