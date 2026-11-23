import type { Database } from './client.js';
import { brands, tags } from './schema.js';

/** Brand e argomenti di partenza, creati solo al primo avvio (database vuoto). */
const DEFAULT_BRAND = { name: 'Il mio brand', initials: 'IB', timezone: 'Europe/Rome' };
const DEFAULT_TAGS = ['Tutorial', 'Novità', 'Carriera', 'Opinioni', 'Dietro le quinte'];

export async function ensureDefaults(db: Database): Promise<void> {
  const [existing] = await db.select({ id: brands.id }).from(brands).limit(1);
  if (existing) return;
  const [brand] = await db.insert(brands).values(DEFAULT_BRAND).returning({ id: brands.id });
  if (!brand) throw new Error('Creazione del brand iniziale fallita');
  await db.insert(tags).values(DEFAULT_TAGS.map((name) => ({ brandId: brand.id, name })));
}
