import type { Brand, BrandInput, BrandUpdate } from '@prisma-app/shared';
import { asc, eq } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { brands } from '../../db/schema.js';

type BrandRow = typeof brands.$inferSelect;

function toBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    timezone: row.timezone,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listBrands(db: DbExecutor): Promise<Brand[]> {
  const rows = await db.select().from(brands).orderBy(asc(brands.id));
  return rows.map(toBrand);
}

export async function findBrand(db: DbExecutor, id: number): Promise<Brand | null> {
  const [row] = await db.select().from(brands).where(eq(brands.id, id));
  return row ? toBrand(row) : null;
}

export async function insertBrand(db: DbExecutor, input: BrandInput): Promise<number> {
  const [created] = await db.insert(brands).values(input).returning({ id: brands.id });
  if (!created) throw new Error('Inserimento brand fallito');
  return created.id;
}

export async function updateBrand(db: DbExecutor, id: number, input: BrandUpdate): Promise<void> {
  if (Object.keys(input).length === 0) return;
  await db.update(brands).set(input).where(eq(brands.id, id));
}
