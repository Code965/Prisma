import type { Content, Variant } from '@prisma-app/shared';
import { desc, eq } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { contents } from '../../db/schema.js';

type ContentRow = typeof contents.$inferSelect;

export function toContent(row: ContentRow, variantList: Variant[]): Content {
  return {
    id: row.id,
    brandId: row.brandId,
    ideaId: row.ideaId,
    title: row.title,
    variants: variantList,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function findContentRow(db: DbExecutor, id: number): Promise<ContentRow | null> {
  const [row] = await db.select().from(contents).where(eq(contents.id, id));
  return row ?? null;
}

export async function listContentRows(db: DbExecutor, brandId: number): Promise<ContentRow[]> {
  return db
    .select()
    .from(contents)
    .where(eq(contents.brandId, brandId))
    .orderBy(desc(contents.createdAt), desc(contents.id));
}

export async function insertContent(
  db: DbExecutor,
  values: { brandId: number; ideaId: number | null; title: string },
): Promise<number> {
  const [created] = await db.insert(contents).values(values).returning({ id: contents.id });
  if (!created) throw new Error('Inserimento contenuto fallito');
  return created.id;
}

export async function updateContentTitle(db: DbExecutor, id: number, title: string): Promise<void> {
  await db.update(contents).set({ title }).where(eq(contents.id, id));
}

export async function deleteContent(db: DbExecutor, id: number): Promise<void> {
  await db.delete(contents).where(eq(contents.id, id));
}
