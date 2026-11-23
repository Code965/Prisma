import { existsSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { loadDotEnv, repoRoot } from '../config/env.js';
import { createDatabase } from './client.js';
import { applyMigrations } from './migrations.js';

/**
 * Copia una volta sola i dati del vecchio server MySQL (fino alla 0.1.1) nel database SQLite.
 *
 *   pnpm --filter @prisma-app/server db:import-mysql            # nell'app desktop
 *   pnpm --filter @prisma-app/server db:import-mysql -- --to data/prisma.db
 *
 * Legge `DATABASE_URL` (mysql://…) e `TOKEN_ENCRYPTION_KEY` dal .env. Gli id restano gli stessi,
 * le date diventano millisecondi UTC, i JSON testo. Per l'app desktop lascia accanto al database
 * la chiave di cifratura del vecchio server, così i token e le chiavi API copiati restano
 * leggibili: l'app la prende al primo avvio, la protegge con Windows e cancella il file.
 * Il database MySQL non viene toccato.
 */

/** In ordine di dipendenza (le chiavi esterne si controllano comunque alla fine). */
const TABLES = [
  'brands',
  'voice_examples',
  'social_accounts',
  'tags',
  'ideas',
  'idea_tags',
  'contents',
  'variants',
  'variant_revisions',
  'chat_messages',
  'assets',
  'variant_assets',
  'templates',
  'publications',
  'publication_attempts',
  'metric_snapshots',
  'analytics_insights',
  'account_metric_snapshots',
  'ai_settings',
] as const;

/** Tabelle con dati dell'utente: un database che ne ha non si sovrascrive senza --replace. */
const USER_TABLES = ['ideas', 'contents', 'social_accounts', 'voice_examples', 'publications'];

type SqlValue = null | number | bigint | string | Uint8Array;

function toSqlite(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  // Colonne JSON: mysql2 le restituisce già lette.
  return JSON.stringify(value);
}

function desktopDataDir(): string {
  const appData = process.env['APPDATA'];
  if (!appData) throw new Error('APPDATA non impostata: indica la destinazione con --to');
  return join(appData, 'Prisma');
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadDotEnv();
  const source = process.env['DATABASE_URL'];
  if (!source?.startsWith('mysql://'))
    throw new Error('DATABASE_URL (mysql://…) mancante nel .env');
  const toArg = argument('--to');
  const forDesktop = !toArg;
  const target = toArg ? resolve(repoRoot(), toArg) : join(desktopDataDir(), 'contenuti.db');
  const replace = process.argv.includes('--replace');

  if (existsSync(target)) {
    const existing = createDatabase(target);
    applyMigrations(existing.sqlite);
    const used = USER_TABLES.filter(
      (table) =>
        (existing.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n >
        0,
    );
    existing.close();
    if (used.length > 0 && !replace) {
      throw new Error(
        `${target} contiene già dati (${used.join(', ')}): rilancia con --replace per sostituirli (ne resta una copia .bak)`,
      );
    }
    if (used.length > 0) copyFileSync(target, `${target}.bak`);
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });
  }

  const connection = await mysql.createConnection({ uri: source, timezone: 'Z' });
  await connection.query("SET time_zone = '+00:00'");
  const database = createDatabase(target);
  const { sqlite } = database;
  try {
    applyMigrations(sqlite);
    sqlite.exec('PRAGMA foreign_keys = OFF');
    sqlite.exec('BEGIN');
    const counts: string[] = [];
    for (const table of TABLES) {
      const [exists] = await connection.query(`SHOW TABLES LIKE '${table}'`);
      if ((exists as unknown[]).length === 0) continue;
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      const records = rows as Record<string, unknown>[];
      const columns = new Set(
        (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
          (column) => column.name,
        ),
      );
      for (const record of records) {
        const names = Object.keys(record).filter((name) => columns.has(name));
        const insert = sqlite.prepare(
          `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        );
        insert.run(...names.map((name) => toSqlite(record[name])));
      }
      counts.push(`${table} ${records.length}`);
    }
    const problems = sqlite.prepare('PRAGMA foreign_key_check').all();
    if (problems.length > 0) {
      throw new Error(
        `Riferimenti non validi dopo la copia: ${JSON.stringify(problems.slice(0, 5))}`,
      );
    }
    sqlite.exec('COMMIT');
    sqlite.exec('PRAGMA foreign_keys = ON');
    console.log(`Copiati in ${target}:\n  ${counts.join('\n  ')}`);
  } catch (error) {
    if (sqlite.isTransaction) sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
    await connection.end();
  }

  if (forDesktop) {
    const key = process.env['TOKEN_ENCRYPTION_KEY']?.trim();
    if (key) {
      writeFileSync(join(dirname(target), 'chiave-importata.txt'), key, 'utf8');
      console.log(
        "Chiave di cifratura pronta per l'app: la prende e la protegge al prossimo avvio.",
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
