import type { EditorialPlan, Platform, VariantStatus } from '@prisma-app/shared';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { contents, editorialPlans, ideas, publications, variants } from '../../db/schema.js';
import { latestSnapshot } from '../analytics/repository.js';
import { romeDay } from '../analytics/aggregate.js';
import type { MonthPublication } from './review.js';

const DAY = 86_400_000;

type PlanRow = typeof editorialPlans.$inferSelect;

export function rowToPlan(row: PlanRow): EditorialPlan {
  return {
    id: row.id,
    month: row.month,
    model: row.model,
    createdAt: toIso(row.createdAt),
    summary: row.summary,
    pillars: row.pillars,
    frequencies: row.frequencies,
    items: row.items,
    reviewComment: row.reviewComment ?? null,
  };
}

export async function findPlan(db: DbExecutor, brandId: number, month: string) {
  const [row] = await db
    .select()
    .from(editorialPlans)
    .where(and(eq(editorialPlans.brandId, brandId), eq(editorialPlans.month, month)));
  return row ?? null;
}

/** Interazioni note (like + commenti + condivisioni + salvataggi); null se nessuna misura. */
function knownInteractions(m: {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}): number | null {
  const known = [m.likes, m.comments, m.shares, m.saves].filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/**
 * Uscite del mese (giorno italiano) programmate, in corso o pubblicate, con l'idea del contenuto
 * e le interazioni dell'ultima lettura per quelle pubblicate.
 */
export async function monthPublications(
  db: DbExecutor,
  brandId: number,
  month: string,
): Promise<(MonthPublication & { title: string })[]> {
  const start = new Date(`${month}-01T00:00:00Z`).getTime() - 2 * DAY;
  const end = start + 35 * DAY;
  const rows = await db
    .select({
      id: publications.id,
      ideaId: contents.ideaId,
      title: contents.title,
      platform: variants.platform,
      scheduledAt: publications.scheduledAt,
      publishedAt: publications.publishedAt,
      status: publications.status,
      url: publications.externalUrl,
    })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .innerJoin(contents, eq(contents.id, variants.contentId))
    .where(
      and(
        eq(contents.brandId, brandId),
        inArray(publications.status, ['programmato', 'in_pubblicazione', 'pubblicato']),
        gte(publications.scheduledAt, new Date(start)),
        lt(publications.scheduledAt, new Date(end)),
      ),
    );
  const result: (MonthPublication & { title: string })[] = [];
  for (const row of rows) {
    const day = romeDay(row.publishedAt ?? row.scheduledAt);
    if (day.slice(0, 7) !== month) continue;
    const status = row.status as MonthPublication['status'];
    const metrics = status === 'pubblicato' ? await latestSnapshot(db, row.id) : null;
    result.push({
      id: row.id,
      ideaId: row.ideaId,
      title: row.title,
      platform: row.platform,
      day,
      status,
      url: row.url,
      interactions: metrics ? knownInteractions(metrics) : null,
    });
  }
  return result.sort((a, b) => a.day.localeCompare(b.day));
}

export async function existingIdeas(db: DbExecutor, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, { plannedDay: string | null }>();
  const rows = await db
    .select({ id: ideas.id, plannedDay: ideas.plannedDay })
    .from(ideas)
    .where(inArray(ideas.id, [...ids]));
  return new Map(rows.map((r) => [r.id, { plannedDay: r.plannedDay }]));
}

/** Variant dei contenuti nati dalle idee. */
export async function ideaVariants(db: DbExecutor, ideaIds: readonly number[]) {
  const map = new Map<number, { platform: Platform; status: VariantStatus }[]>();
  if (ideaIds.length === 0) return map;
  const rows = await db
    .select({ ideaId: contents.ideaId, platform: variants.platform, status: variants.status })
    .from(contents)
    .innerJoin(variants, eq(variants.contentId, contents.id))
    .where(inArray(contents.ideaId, [...ideaIds]));
  for (const { ideaId, ...variant } of rows) {
    if (ideaId === null) continue;
    map.set(ideaId, [...(map.get(ideaId) ?? []), variant]);
  }
  return map;
}
