import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.generated.js';

/**
 * Applica le migrazioni mancanti (registrate in `__prisma_migrations`), ciascuna in una
 * transazione. Le stesse per il server da solo e per quello dentro l'app desktop.
 */
export function applyMigrations(
  sqlite: DatabaseSync,
  migrations: readonly { tag: string; sql: string }[] = MIGRATIONS,
): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __prisma_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const done = new Set(
    (sqlite.prepare('SELECT tag FROM __prisma_migrations').all() as { tag: string }[]).map(
      (row) => row.tag,
    ),
  );
  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.tag)) continue;
    sqlite.exec('BEGIN');
    try {
      for (const statement of migration.sql.split('--> statement-breakpoint')) {
        if (statement.trim()) sqlite.exec(statement);
      }
      sqlite
        .prepare('INSERT INTO __prisma_migrations (tag, applied_at) VALUES (?, ?)')
        .run(migration.tag, Date.now());
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw new Error(`Migrazione ${migration.tag} non riuscita`, { cause: error });
    }
    applied.push(migration.tag);
  }
  return applied;
}
