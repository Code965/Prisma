import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

/** Coda: una sola operazione alla volta sulla connessione (SQLite ha un solo scrittore). */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Database SQLite in un file (o `:memory:` nei test) con `node:sqlite`, il modulo integrato in
 * Node 24 ed Electron: niente moduli nativi da ricompilare. Drizzle lo usa tramite il driver
 * `sqlite-proxy`, che passa ogni query a `execute`.
 *
 * Una connessione sola: le transazioni (e le query fuori transazione) passano da una coda, così
 * due operazioni asincrone non finiscono nella stessa transazione. Dentro una transazione
 * (`AsyncLocalStorage`) le query vanno dirette e le transazioni annidate diventano savepoint.
 */
export function createDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      statements.set(sql, statement);
    }
    return statement;
  };

  type Param = null | number | bigint | string | NodeJS.ArrayBufferView;
  const execute = (sql: string, params: unknown[], method: 'run' | 'all' | 'values' | 'get') => {
    const args = params as Param[];
    // BEGIN/COMMIT/SAVEPOINT non si preparano una volta per tutte: si eseguono e basta.
    if (/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(sql)) {
      sqlite.exec(sql);
      return { rows: [] as unknown[] };
    }
    const statement = prepare(sql);
    if (method === 'run') {
      const result = statement.run(...args);
      return { rows: [] as unknown[], changes: Number(result.changes) };
    }
    // `get`: la riga (un array) o undefined; `all`/`values`: le righe. Il tipo del proxy è largo.
    if (method === 'get') return { rows: statement.get(...args) as unknown as unknown[] };
    return { rows: statement.all(...args) as unknown[] };
  };

  const lock = new Mutex();
  const inTransaction = new AsyncLocalStorage<boolean>();

  const db = drizzle(
    async (sql, params, method) =>
      inTransaction.getStore()
        ? execute(sql, params, method)
        : lock.run(async () => execute(sql, params, method)),
    { schema },
  );

  const transaction = db.transaction.bind(db);
  // Una transazione chiesta mentre se ne è già dentro (servizio che ne chiama un altro con il
  // database principale) si unisce a quella in corso.
  db.transaction = ((run, config) =>
    inTransaction.getStore()
      ? run(db as never)
      : lock.run(() =>
          inTransaction.run(true, () => transaction(run, config)),
        )) as typeof db.transaction;

  return {
    db,
    /** Esecuzione diretta di SQL (migrazioni). */
    sqlite,
    close: () => sqlite.close(),
  };
}
