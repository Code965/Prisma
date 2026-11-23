import type { BrandKit, VoiceExample, VoiceExampleInput } from '@prisma-app/shared';
import { desc, eq } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { brands, voiceExamples } from '../../db/schema.js';

export async function findKit(db: DbExecutor, brandId: number): Promise<BrandKit | null> {
  const [row] = await db.select({ kit: brands.kit }).from(brands).where(eq(brands.id, brandId));
  return row?.kit ?? null;
}

export async function saveKit(db: DbExecutor, brandId: number, kit: BrandKit): Promise<void> {
  await db.update(brands).set({ kit }).where(eq(brands.id, brandId));
}

type VoiceRow = typeof voiceExamples.$inferSelect;

function toVoiceExample(row: VoiceRow): VoiceExample {
  return {
    id: row.id,
    brandId: row.brandId,
    platform: row.platform,
    text: row.text,
    note: row.note,
    createdAt: toIso(row.createdAt),
  };
}

/** Dal più recente: quelli aggiunti per ultimi sono i primi a entrare nei prompt. */
export async function listVoiceExamples(
  db: DbExecutor,
  brandId: number,
  limit?: number,
): Promise<VoiceExample[]> {
  const query = db
    .select()
    .from(voiceExamples)
    .where(eq(voiceExamples.brandId, brandId))
    .orderBy(desc(voiceExamples.createdAt), desc(voiceExamples.id));
  const rows = limit ? await query.limit(limit) : await query;
  return rows.map(toVoiceExample);
}

export async function findVoiceExample(db: DbExecutor, id: number): Promise<VoiceExample | null> {
  const [row] = await db.select().from(voiceExamples).where(eq(voiceExamples.id, id));
  return row ? toVoiceExample(row) : null;
}

export async function insertVoiceExample(
  db: DbExecutor,
  brandId: number,
  input: VoiceExampleInput,
): Promise<number> {
  const [created] = await db
    .insert(voiceExamples)
    .values({ brandId, ...input })
    .returning({ id: voiceExamples.id });
  if (!created) throw new Error('Inserimento esempio di voce fallito');
  return created.id;
}

export async function deleteVoiceExample(db: DbExecutor, id: number): Promise<void> {
  await db.delete(voiceExamples).where(eq(voiceExamples.id, id));
}
