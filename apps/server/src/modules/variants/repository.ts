import type {
  Platform,
  Variant,
  VariantFormat,
  VariantMetadata,
  VariantRevision,
  VariantStatus,
} from '@prisma-app/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { affectedRows, toIso, toIsoOrNull, type DbExecutor } from '../../db/executor.js';
import { publications, variantRevisions, variants } from '../../db/schema.js';

type VariantRow = typeof variants.$inferSelect;
type RevisionRow = typeof variantRevisions.$inferSelect;

export function toVariant(row: VariantRow): Variant {
  return {
    id: row.id,
    contentId: row.contentId,
    platform: row.platform,
    format: row.format,
    body: row.body,
    metadata: row.metadata,
    status: row.status,
    version: row.version,
    approvedAt: toIsoOrNull(row.approvedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toRevision(row: RevisionRow): VariantRevision {
  return {
    id: row.id,
    variantId: row.variantId,
    body: row.body,
    metadata: row.metadata,
    source: row.source,
    instruction: row.instruction,
    createdAt: toIso(row.createdAt),
  };
}

/** Con `forUpdate` la riga resta bloccata fino alla fine della transazione. */
export async function findVariantRow(
  db: DbExecutor,
  id: number,
  options: { forUpdate?: boolean } = {},
): Promise<VariantRow | null> {
  const query = db.select().from(variants).where(eq(variants.id, id));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function listVariantsOfContents(
  db: DbExecutor,
  contentIds: number[],
): Promise<Map<number, Variant[]>> {
  const byContent = new Map<number, Variant[]>();
  if (contentIds.length === 0) return byContent;
  const rows = await db
    .select()
    .from(variants)
    .where(inArray(variants.contentId, contentIds))
    .orderBy(asc(variants.id));
  for (const row of rows) {
    byContent.set(row.contentId, [...(byContent.get(row.contentId) ?? []), toVariant(row)]);
  }
  return byContent;
}

export async function insertVariant(
  db: DbExecutor,
  values: {
    contentId: number;
    platform: Platform;
    format: VariantFormat;
    body: string;
    metadata: VariantMetadata;
  },
): Promise<number> {
  const [created] = await db.insert(variants).values(values).$returningId();
  if (!created) throw new Error('Inserimento variant fallito');
  return created.id;
}

/**
 * Aggiorna solo se la versione è ancora quella attesa e la incrementa.
 * Restituisce false se qualcun altro l'ha modificata nel frattempo.
 */
export async function updateVariantIfVersion(
  db: DbExecutor,
  id: number,
  expectedVersion: number,
  values: Partial<{
    body: string;
    metadata: VariantMetadata;
    format: VariantFormat;
    status: VariantStatus;
    approvedAt: Date | null;
  }>,
): Promise<boolean> {
  const result = await db
    .update(variants)
    .set({ ...values, version: sql`${variants.version} + 1` })
    .where(and(eq(variants.id, id), eq(variants.version, expectedVersion)));
  return affectedRows(result) === 1;
}

export async function deleteVariant(db: DbExecutor, id: number): Promise<void> {
  await db.delete(variants).where(eq(variants.id, id));
}

export async function countPublicationsOfVariants(
  db: DbExecutor,
  variantIds: number[],
): Promise<number> {
  if (variantIds.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(publications)
    .where(inArray(publications.variantId, variantIds));
  return Number(row?.n ?? 0);
}

export async function insertRevision(
  db: DbExecutor,
  values: {
    variantId: number;
    body: string;
    metadata: VariantMetadata;
    source: VariantRevision['source'];
    instruction?: string | null;
  },
): Promise<number> {
  const [created] = await db.insert(variantRevisions).values(values).$returningId();
  if (!created) throw new Error('Inserimento revisione fallito');
  return created.id;
}

export async function listRevisions(db: DbExecutor, variantId: number): Promise<VariantRevision[]> {
  const rows = await db
    .select()
    .from(variantRevisions)
    .where(eq(variantRevisions.variantId, variantId))
    .orderBy(desc(variantRevisions.createdAt), desc(variantRevisions.id));
  return rows.map(toRevision);
}

export async function findRevision(
  db: DbExecutor,
  variantId: number,
  revisionId: number,
): Promise<VariantRevision | null> {
  const [row] = await db
    .select()
    .from(variantRevisions)
    .where(and(eq(variantRevisions.id, revisionId), eq(variantRevisions.variantId, variantId)));
  return row ? toRevision(row) : null;
}
