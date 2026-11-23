import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { loadDotEnv, parseEnv } from '../config/env.js';
import { createDatabase } from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

async function main(): Promise<void> {
  loadDotEnv();
  const env = parseEnv(process.env);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrazioni applicate.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
