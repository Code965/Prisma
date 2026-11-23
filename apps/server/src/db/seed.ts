import { eq } from 'drizzle-orm';
import { loadDotEnv, parseEnv } from '../config/env.js';
import { createDatabase, type Database } from './client.js';
import { brands, tags } from './schema.js';

/** Dati iniziali, ripresi dal mockup. Lo script è idempotente: si può rilanciare. */
const DEFAULT_BRAND = { name: 'Creator', initials: 'CR', timezone: 'Europe/Rome' };
const DEFAULT_TAGS = ['.NET', 'GIS', 'Carriera', 'AI locale', 'Dietro le quinte'];

async function ensureBrand(db: Database): Promise<number> {
  const [existing] = await db.select({ id: brands.id }).from(brands).limit(1);
  if (existing) return existing.id;
  const [result] = await db.insert(brands).values(DEFAULT_BRAND).$returningId();
  if (!result) throw new Error('Creazione del brand fallita');
  return result.id;
}

async function ensureTags(db: Database, brandId: number): Promise<number> {
  const existing = await db.select({ name: tags.name }).from(tags).where(eq(tags.brandId, brandId));
  const known = new Set(existing.map((tag) => tag.name));
  const missing = DEFAULT_TAGS.filter((name) => !known.has(name));
  if (missing.length > 0) {
    await db.insert(tags).values(missing.map((name) => ({ brandId, name })));
  }
  return missing.length;
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = parseEnv(process.env);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    const brandId = await ensureBrand(db);
    const added = await ensureTags(db, brandId);
    console.log(`Seed completato: brand ${brandId}, ${added} tag aggiunti.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
