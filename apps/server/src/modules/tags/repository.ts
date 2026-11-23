import type { Tag } from '@prisma-app/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/executor.js';
import { tags } from '../../db/schema.js';

const tagColumns = { id: tags.id, brandId: tags.brandId, name: tags.name };

export async function listTags(db: DbExecutor, brandId: number): Promise<Tag[]> {
  return db.select(tagColumns).from(tags).where(eq(tags.brandId, brandId)).orderBy(asc(tags.name));
}

export async function findTag(db: DbExecutor, id: number): Promise<Tag | null> {
  const [row] = await db.select(tagColumns).from(tags).where(eq(tags.id, id));
  return row ?? null;
}

export async function countTagsOfBrand(
  db: DbExecutor,
  brandId: number,
  ids: readonly number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.brandId, brandId), inArray(tags.id, [...ids])));
  return rows.length;
}

export async function insertTag(db: DbExecutor, brandId: number, name: string): Promise<number> {
  const [created] = await db.insert(tags).values({ brandId, name }).$returningId();
  if (!created) throw new Error('Inserimento tag fallito');
  return created.id;
}

export async function deleteTag(db: DbExecutor, id: number): Promise<void> {
  await db.delete(tags).where(eq(tags.id, id));
}
