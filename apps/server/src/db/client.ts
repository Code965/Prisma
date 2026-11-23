import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(databaseUrl: string) {
  const pool = mysql.createPool({
    uri: databaseUrl,
    // Date JS ↔ DATETIME senza conversioni con il fuso della macchina.
    timezone: 'Z',
    connectionLimit: 10,
    supportBigNumbers: true,
  });
  // Anche le funzioni SQL (CURRENT_TIMESTAMP nei default) devono lavorare in UTC,
  // qualunque sia il fuso configurato sul server MySQL. La query viene accodata
  // sulla connessione prima di qualsiasi altra.
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}
