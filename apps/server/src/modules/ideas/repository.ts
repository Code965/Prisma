import type {
  Idea,
  IdeaInspiration,
  IdeaListQuery,
  IdeaSource,
  IdeaStatus,
  Platform,
  Tag,
} from '@prisma-app/shared';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { ideaTags, ideas, tags } from '../../db/schema.js';

type IdeaRow = typeof ideas.$inferSelect;

function toIdea(row: IdeaRow, ideaTagList: Tag[]): Idea {
  return {
    id: row.id,
    brandId: row.brandId,
    text: row.text,
    source: row.source,
    status: row.status,
    targetPlatforms: row.targetPlatforms,
    inspiration: row.inspiration ?? null,
    tags: ideaTagList,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function loadTags(db: DbExecutor, ideaIds: number[]): Promise<Map<number, Tag[]>> {
  const byIdea = new Map<number, Tag[]>();
  if (ideaIds.length === 0) return byIdea;
  const rows = await db
    .select({ ideaId: ideaTags.ideaId, id: tags.id, brandId: tags.brandId, name: tags.name })
    .from(ideaTags)
    .innerJoin(tags, eq(tags.id, ideaTags.tagId))
    .where(inArray(ideaTags.ideaId, ideaIds))
    .orderBy(tags.name);
  for (const { ideaId, ...tag } of rows) {
    byIdea.set(ideaId, [...(byIdea.get(ideaId) ?? []), tag]);
  }
  return byIdea;
}

export async function listIdeas(
  db: DbExecutor,
  brandId: number,
  query: IdeaListQuery,
): Promise<Idea[]> {
  const conditions: SQL[] = [eq(ideas.brandId, brandId)];
  if (query.status) conditions.push(eq(ideas.status, query.status));
  if (query.tagId) {
    const tagged = db
      .select({ id: ideaTags.ideaId })
      .from(ideaTags)
      .where(eq(ideaTags.tagId, query.tagId));
    conditions.push(inArray(ideas.id, tagged));
  }
  const rows = await db
    .select()
    .from(ideas)
    .where(and(...conditions))
    .orderBy(desc(ideas.createdAt), desc(ideas.id));
  const tagMap = await loadTags(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toIdea(row, tagMap.get(row.id) ?? []));
}

export async function findIdea(db: DbExecutor, id: number): Promise<Idea | null> {
  const [row] = await db.select().from(ideas).where(eq(ideas.id, id));
  if (!row) return null;
  const tagMap = await loadTags(db, [id]);
  return toIdea(row, tagMap.get(id) ?? []);
}

export async function insertIdea(
  db: DbExecutor,
  values: {
    brandId: number;
    text: string;
    source: IdeaSource;
    targetPlatforms: Platform[];
    inspiration?: IdeaInspiration | null;
  },
): Promise<number> {
  const [created] = await db.insert(ideas).values(values).returning({ id: ideas.id });
  if (!created) throw new Error('Inserimento idea fallito');
  return created.id;
}

export async function updateIdea(
  db: DbExecutor,
  id: number,
  values: Partial<{ text: string; targetPlatforms: Platform[]; status: IdeaStatus }>,
): Promise<void> {
  if (Object.keys(values).length === 0) return;
  await db.update(ideas).set(values).where(eq(ideas.id, id));
}

export async function replaceIdeaTags(
  db: DbExecutor,
  ideaId: number,
  tagIds: readonly number[],
): Promise<void> {
  await db.delete(ideaTags).where(eq(ideaTags.ideaId, ideaId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    await db.insert(ideaTags).values(unique.map((tagId) => ({ ideaId, tagId })));
  }
}

export async function deleteIdea(db: DbExecutor, id: number): Promise<void> {
  await db.delete(ideas).where(eq(ideas.id, id));
}
