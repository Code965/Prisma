import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Cartella dei dati dell'app. Fino al cambio di nome (Cronaca → Prisma) Electron la ricavava dal
 * nome del pacchetto (`%APPDATA%\@cronaca\desktop`); ora è `%APPDATA%\Prisma`. Alla prima apertura
 * la vecchia cartella si sposta (database locale, impostazioni con il token cifrato, modello
 * Whisper, export): il token resta leggibile perché la chiave di `safeStorage` su Windows è nel
 * file `Local State`, che si sposta con il resto.
 */

export const DATA_DIR_NAME = 'Prisma';
const LEGACY_DIR = ['@cronaca', 'desktop'];
const LEGACY_DB = 'cronaca.db';
const DB = 'prisma.db';

export interface DataDirResult {
  userData: string;
  /** Cosa è successo, per il log. */
  outcome: 'nuova' | 'spostata' | 'unita' | 'vecchia';
  error?: string;
}

/** Percorsi assoluti nei progetti video: dalla vecchia cartella alla nuova, anche in JSON. */
function rewriteProjectPaths(dbPath: string, from: string, to: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'video_projects'")
      .get();
    if (!exists) return;
    const escape = (path: string) => JSON.stringify(path).slice(1, -1);
    const update = db.prepare('UPDATE video_projects SET data = REPLACE(data, ?, ?)');
    update.run(escape(from), escape(to));
    update.run(from, to);
  } finally {
    db.close();
  }
}

/** Dati dell'app da non perdere (il resto della cartella è cache di Chromium). */
const KEEP = ['whisper-models', 'video-tools.json', 'settings.json', 'filmcraft', 'esportazioni'];

/**
 * Esistono tutte e due le cartelle (es. la nuova creata prima che la vecchia fosse spostata): si
 * portano nella nuova i dati che le mancano, senza sovrascrivere nulla. Negli export si spostano le
 * sottocartelle assenti. La vecchia cartella resta con la sola cache, da cancellare a mano.
 */
function mergeLegacy(legacy: string, target: string): DataDirResult {
  let moved = 0;
  try {
    for (const name of KEEP) {
      const from = join(legacy, name);
      const to = join(target, name);
      if (!existsSync(from)) continue;
      if (!existsSync(to)) {
        renameSync(from, to);
        moved++;
      } else if (name === 'esportazioni') {
        for (const child of readdirSync(from)) {
          if (existsSync(join(to, child))) continue;
          renameSync(join(from, child), join(to, child));
          moved++;
        }
      }
    }
  } catch (error) {
    return {
      userData: target,
      outcome: 'nuova',
      error: `Dati vecchi non spostati del tutto: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { userData: target, outcome: moved > 0 ? 'unita' : 'nuova' };
}

export function resolveDataDir(appData: string): DataDirResult {
  const target = join(appData, DATA_DIR_NAME);
  const legacy = join(appData, ...LEGACY_DIR);
  if (!existsSync(legacy)) return { userData: target, outcome: 'nuova' };
  if (existsSync(target)) return mergeLegacy(legacy, target);
  try {
    renameSync(legacy, target);
  } catch (error) {
    // Cartella in uso (la vecchia app è ancora aperta): per questa volta si resta lì.
    return {
      userData: legacy,
      outcome: 'vecchia',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const file = join(target, LEGACY_DB + suffix);
    if (existsSync(file)) renameSync(file, join(target, DB + suffix));
  }
  if (existsSync(join(target, DB))) rewriteProjectPaths(join(target, DB), legacy, target);
  const parent = join(appData, LEGACY_DIR[0]!);
  if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
  return { userData: target, outcome: 'spostata' };
}
