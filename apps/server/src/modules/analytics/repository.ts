import type { Platform, PublicationMetrics } from '@prisma-app/shared';
import { and, desc, eq, gte, inArray, isNotNull, lte, max } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import {
  accountMetricSnapshots,
  contents,
  metricSnapshots,
  publications,
  socialAccounts,
  variants,
} from '../../db/schema.js';
import type { AccountDayMetrics, MetricSample } from '../../publishers/types.js';

/** Pubblicazioni recenti di piattaforme con metriche, con l'ultima rilevazione dall'API. */
export async function metricCandidates(
  db: DbExecutor,
  platforms: readonly Platform[],
  publishedSince: Date,
) {
  if (platforms.length === 0) return [];
  const last = db
    .select({
      publicationId: metricSnapshots.publicationId,
      lastCapturedAt: max(metricSnapshots.capturedAt).as('last_captured_at'),
    })
    .from(metricSnapshots)
    .where(eq(metricSnapshots.source, 'api'))
    .groupBy(metricSnapshots.publicationId)
    .as('last');
  return db
    .select({
      id: publications.id,
      externalId: publications.externalId,
      publishedAt: publications.publishedAt,
      platform: variants.platform,
      lastCapturedAt: last.lastCapturedAt,
      account: socialAccounts,
    })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publications.socialAccountId))
    .leftJoin(last, eq(last.publicationId, publications.id))
    .where(
      and(
        eq(publications.status, 'pubblicato'),
        isNotNull(publications.externalId),
        gte(publications.publishedAt, publishedSince),
        inArray(variants.platform, [...platforms]),
      ),
    );
}

export async function insertSnapshot(
  db: DbExecutor,
  publicationId: number,
  sample: MetricSample,
  source: 'api' | 'manuale',
): Promise<void> {
  await db.insert(metricSnapshots).values({
    publicationId,
    capturedAt: sample.capturedAt,
    impressions: sample.impressions ?? null,
    reach: sample.reach ?? null,
    views: sample.views ?? null,
    likes: sample.likes ?? null,
    comments: sample.comments ?? null,
    shares: sample.shares ?? null,
    saves: sample.saves ?? null,
    source,
    raw: sample.raw ?? null,
  });
}

export async function latestSnapshot(
  db: DbExecutor,
  publicationId: number,
): Promise<PublicationMetrics | null> {
  const [row] = await db
    .select()
    .from(metricSnapshots)
    .where(eq(metricSnapshots.publicationId, publicationId))
    .orderBy(desc(metricSnapshots.capturedAt), desc(metricSnapshots.id))
    .limit(1);
  if (!row) return null;
  return {
    publicationId: row.publicationId,
    capturedAt: toIso(row.capturedAt),
    impressions: row.impressions,
    reach: row.reach,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    source: row.source,
  };
}

/** Account collegati di piattaforme con metriche, con l'ultimo giorno salvato. */
export async function accountCandidates(db: DbExecutor, platforms: readonly Platform[]) {
  if (platforms.length === 0) return [];
  const last = db
    .select({
      socialAccountId: accountMetricSnapshots.socialAccountId,
      lastDay: max(accountMetricSnapshots.day).as('last_day'),
      lastCapturedAt: max(accountMetricSnapshots.capturedAt).as('last_captured_at'),
    })
    .from(accountMetricSnapshots)
    .groupBy(accountMetricSnapshots.socialAccountId)
    .as('last');
  return db
    .select({ account: socialAccounts, lastDay: last.lastDay, lastCapturedAt: last.lastCapturedAt })
    .from(socialAccounts)
    .leftJoin(last, eq(last.socialAccountId, socialAccounts.id))
    .where(
      and(
        inArray(socialAccounts.platform, [...platforms]),
        inArray(socialAccounts.status, ['collegato', 'da_rinnovare']),
      ),
    );
}

/** Un giorno per account: i valori nuovi sostituiscono i vecchi, quelli assenti restano. */
export async function upsertAccountDay(
  db: DbExecutor,
  socialAccountId: number,
  metrics: AccountDayMetrics,
  capturedAt: Date,
): Promise<void> {
  const values = {
    followers: metrics.followers ?? null,
    followersGained: metrics.followersGained ?? null,
    followersLost: metrics.followersLost ?? null,
    reach: metrics.reach ?? null,
    views: metrics.views ?? null,
  };
  const update = Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [key, value]),
  );
  await db
    .insert(accountMetricSnapshots)
    .values({ socialAccountId, day: metrics.day, capturedAt, ...values, raw: metrics.raw ?? null })
    .onConflictDoUpdate({
      target: [accountMetricSnapshots.socialAccountId, accountMetricSnapshots.day],
      set: { ...update, capturedAt },
    });
}

export async function updateExternal(
  db: DbExecutor,
  publicationId: number,
  resolved: { externalId: string; externalUrl: string | null },
): Promise<void> {
  await db
    .update(publications)
    .set({ externalId: resolved.externalId, externalUrl: resolved.externalUrl })
    .where(eq(publications.id, publicationId));
}

/** Giorni degli account del brand nell'intervallo (estremi inclusi). */
export async function accountDaysForBrand(
  db: DbExecutor,
  brandId: number,
  fromDay: string,
  toDay: string,
) {
  return db
    .select({
      platform: socialAccounts.platform,
      day: accountMetricSnapshots.day,
      followers: accountMetricSnapshots.followers,
      followersGained: accountMetricSnapshots.followersGained,
      followersLost: accountMetricSnapshots.followersLost,
      reach: accountMetricSnapshots.reach,
      views: accountMetricSnapshots.views,
    })
    .from(accountMetricSnapshots)
    .innerJoin(socialAccounts, eq(socialAccounts.id, accountMetricSnapshots.socialAccountId))
    .where(
      and(
        eq(socialAccounts.brandId, brandId),
        gte(accountMetricSnapshots.day, fromDay),
        lte(accountMetricSnapshots.day, toDay),
      ),
    );
}

/** Post pubblicati del brand dal momento indicato, con l'ultima lettura delle metriche. */
export async function publishedPostsForBrand(db: DbExecutor, brandId: number, since: Date) {
  const latest = db
    .select({
      publicationId: metricSnapshots.publicationId,
      lastId: max(metricSnapshots.id).as('last_id'),
    })
    .from(metricSnapshots)
    .groupBy(metricSnapshots.publicationId)
    .as('latest');
  const rows = await db
    .select({
      publicationId: publications.id,
      contentId: contents.id,
      title: contents.title,
      platform: variants.platform,
      format: variants.format,
      publishedAt: publications.publishedAt,
      externalUrl: publications.externalUrl,
      snapshot: metricSnapshots,
    })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .innerJoin(contents, eq(contents.id, variants.contentId))
    .leftJoin(latest, eq(latest.publicationId, publications.id))
    .leftJoin(metricSnapshots, eq(metricSnapshots.id, latest.lastId))
    .where(
      and(
        eq(contents.brandId, brandId),
        eq(publications.status, 'pubblicato'),
        gte(publications.publishedAt, since),
      ),
    );
  return rows.map(({ snapshot, publishedAt, ...row }) => ({
    ...row,
    publishedAt: publishedAt!,
    metrics: snapshot
      ? ({
          publicationId: snapshot.publicationId,
          capturedAt: toIso(snapshot.capturedAt),
          impressions: snapshot.impressions,
          reach: snapshot.reach,
          views: snapshot.views,
          likes: snapshot.likes,
          comments: snapshot.comments,
          shares: snapshot.shares,
          saves: snapshot.saves,
          source: snapshot.source,
        } satisfies PublicationMetrics)
      : null,
  }));
}
