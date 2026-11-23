import type {
  PublicationAttempt,
  PublicationListQuery,
  PublicationStatus,
  PublicationView,
} from '@prisma-app/shared';
import { and, asc, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { affectedRows, toIso, toIsoOrNull, type DbExecutor } from '../../db/executor.js';
import { contents, publicationAttempts, publications, variants } from '../../db/schema.js';

type PublicationRow = typeof publications.$inferSelect;
export type PublicationUpdate = Partial<
  Pick<
    typeof publications.$inferInsert,
    | 'status'
    | 'scheduledAt'
    | 'nextAttemptAt'
    | 'attempts'
    | 'lockedBy'
    | 'lockedAt'
    | 'externalId'
    | 'externalUrl'
    | 'lastError'
    | 'publishedAt'
    | 'uploadSession'
    | 'preparedAt'
  >
>;

const viewColumns = {
  publication: publications,
  platform: variants.platform,
  format: variants.format,
  contentId: contents.id,
  contentTitle: contents.title,
};

type ViewRow = {
  publication: PublicationRow;
  platform: PublicationView['platform'];
  format: PublicationView['format'];
  contentId: number;
  contentTitle: string;
};

function toView({ publication: p, ...rest }: ViewRow): PublicationView {
  return {
    id: p.id,
    variantId: p.variantId,
    socialAccountId: p.socialAccountId,
    scheduledAt: toIso(p.scheduledAt),
    status: p.status,
    attempts: p.attempts,
    maxAttempts: p.maxAttempts,
    nextAttemptAt: toIsoOrNull(p.nextAttemptAt),
    externalId: p.externalId,
    externalUrl: p.externalUrl,
    lastError: p.lastError,
    publishedAt: toIsoOrNull(p.publishedAt),
    createdAt: toIso(p.createdAt),
    updatedAt: toIso(p.updatedAt),
    ...rest,
  };
}

function viewQuery(db: DbExecutor) {
  return db
    .select(viewColumns)
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .innerJoin(contents, eq(contents.id, variants.contentId));
}

export async function listPublications(
  db: DbExecutor,
  query: PublicationListQuery,
): Promise<PublicationView[]> {
  const conditions: SQL[] = [eq(contents.brandId, query.brandId)];
  if (query.from) conditions.push(gte(publications.scheduledAt, new Date(query.from)));
  if (query.to) conditions.push(lt(publications.scheduledAt, new Date(query.to)));
  if (query.status?.length) conditions.push(inArray(publications.status, query.status));
  const rows = await viewQuery(db)
    .where(and(...conditions))
    .orderBy(asc(publications.scheduledAt), asc(publications.id));
  return rows.map(toView);
}

export async function findPublicationView(
  db: DbExecutor,
  id: number,
): Promise<PublicationView | null> {
  const [row] = await viewQuery(db).where(eq(publications.id, id));
  return row ? toView(row) : null;
}

export async function findPublicationRow(
  db: DbExecutor,
  id: number,
  // Con SQLite le transazioni sono già una alla volta (coda in db/client.ts): il blocco della
  // riga che serviva con MySQL non c'è più; l'opzione resta per chi la passa.
  _options: { forUpdate?: boolean } = {},
): Promise<PublicationRow | null> {
  const query = db.select().from(publications).where(eq(publications.id, id));
  const [row] = await query;
  return row ?? null;
}

export async function insertPublication(
  db: DbExecutor,
  values: {
    variantId: number;
    socialAccountId: number;
    scheduledAt: Date;
    idempotencyKey: string;
  },
): Promise<number> {
  const [created] = await db
    .insert(publications)
    .values({ ...values, status: 'programmato', nextAttemptAt: values.scheduledAt })
    .returning({ id: publications.id });
  if (!created) throw new Error('Inserimento pubblicazione fallito');
  return created.id;
}

/** Aggiorna solo se lo stato è ancora quello letto: protegge dalle corse con lo scheduler. */
export async function updatePublicationIfStatus(
  db: DbExecutor,
  id: number,
  expectedStatus: PublicationStatus,
  values: PublicationUpdate,
): Promise<boolean> {
  const result = await db
    .update(publications)
    .set(values)
    .where(and(eq(publications.id, id), eq(publications.status, expectedStatus)));
  return affectedRows(result) === 1;
}

export async function listAttempts(
  db: DbExecutor,
  publicationId: number,
): Promise<PublicationAttempt[]> {
  const rows = await db
    .select()
    .from(publicationAttempts)
    .where(eq(publicationAttempts.publicationId, publicationId))
    .orderBy(desc(publicationAttempts.attemptNo));
  return rows.map((row) => ({
    id: row.id,
    publicationId: row.publicationId,
    attemptNo: row.attemptNo,
    startedAt: toIso(row.startedAt),
    finishedAt: toIsoOrNull(row.finishedAt),
    outcome: row.outcome,
    error: row.error,
  }));
}
