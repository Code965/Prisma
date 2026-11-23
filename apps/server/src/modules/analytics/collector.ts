import type { Platform } from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import {
  MetricsNotReadyError,
  type PlatformMetrics,
  type PublisherRegistry,
} from '../../publishers/types.js';
import type { AccessTokenResolver } from '../social-accounts/tokens.js';
import * as repo from './repository.js';
import {
  METRICS_WINDOW_DAYS,
  accountMetricsDue,
  accountRange,
  postMetricsDue,
} from './schedule.js';

export interface CollectorLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
}

export interface CollectSummary {
  posts: number;
  notReady: number;
  accounts: number;
  failed: number;
}

const silent: CollectorLogger = { info() {}, warn() {} };

/**
 * Raccolta delle metriche (fase 4): a ogni giro aggiorna i post dovuti e gli account una volta al
 * giorno, con gli adapter che le espongono (Instagram, YouTube, TikTok). Gli errori di un post o
 * di un account non fermano gli altri.
 */
export function createMetricsCollector(options: {
  db: DbExecutor;
  publishers: PublisherRegistry;
  accessToken: AccessTokenResolver;
  now?: () => Date;
  batchSize?: number;
  logger?: CollectorLogger;
}) {
  const { db, publishers, accessToken } = options;
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? 25;
  const logger = options.logger ?? silent;

  function withMetrics(): Map<Platform, PlatformMetrics> {
    const result = new Map<Platform, PlatformMetrics>();
    for (const adapter of publishers.values()) {
      if (adapter.metrics) result.set(adapter.platform, adapter.metrics);
    }
    return result;
  }

  async function collectPosts(metrics: Map<Platform, PlatformMetrics>, summary: CollectSummary) {
    const at = now();
    const since = new Date(at.getTime() - METRICS_WINDOW_DAYS * 24 * 60 * 60_000);
    const candidates = await repo.metricCandidates(db, [...metrics.keys()], since);
    const due = candidates
      .filter((c) => c.publishedAt && postMetricsDue(c.publishedAt, c.lastCapturedAt, at))
      .slice(0, batchSize);
    for (const candidate of due) {
      const source = metrics.get(candidate.platform)!;
      try {
        const token = await accessToken(candidate.account);
        const sample = await source.post(candidate.externalId!, {
          id: candidate.account.id,
          externalId: candidate.account.externalId,
          accessToken: token,
        });
        if (sample.resolved) await repo.updateExternal(db, candidate.id, sample.resolved);
        await repo.insertSnapshot(db, candidate.id, { ...sample, capturedAt: at }, 'api');
        summary.posts++;
      } catch (error) {
        if (error instanceof MetricsNotReadyError) {
          summary.notReady++;
          continue;
        }
        summary.failed++;
        logger.warn(
          {
            publicationId: candidate.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'Metriche del post non lette',
        );
      }
    }
  }

  async function collectAccounts(metrics: Map<Platform, PlatformMetrics>, summary: CollectSummary) {
    const at = now();
    for (const { account, lastDay, lastCapturedAt } of await repo.accountCandidates(db, [
      ...metrics.keys(),
    ])) {
      if (!accountMetricsDue(lastCapturedAt, at)) continue;
      const { fromDay, toDay } = accountRange(lastDay, at);
      try {
        const token = await accessToken(account);
        const days = await metrics
          .get(account.platform)!
          .account(
            { id: account.id, externalId: account.externalId, accessToken: token },
            fromDay,
            toDay,
          );
        for (const day of days) await repo.upsertAccountDay(db, account.id, day, at);
        summary.accounts++;
      } catch (error) {
        summary.failed++;
        logger.warn(
          { accountId: account.id, error: error instanceof Error ? error.message : String(error) },
          'Metriche dell’account non lette',
        );
      }
    }
  }

  async function runOnce(): Promise<CollectSummary> {
    const summary: CollectSummary = { posts: 0, notReady: 0, accounts: 0, failed: 0 };
    const metrics = withMetrics();
    await collectPosts(metrics, summary);
    await collectAccounts(metrics, summary);
    if (summary.posts || summary.accounts || summary.failed)
      logger.info(summary, 'Metriche raccolte');
    return summary;
  }

  let timer: NodeJS.Timeout | undefined;
  return {
    runOnce,
    start(intervalMs: number) {
      const tick = () =>
        void runOnce().catch((error: unknown) =>
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'Raccolta metriche fallita',
          ),
        );
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

export type MetricsCollector = ReturnType<typeof createMetricsCollector>;
