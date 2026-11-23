import type { Database } from './client.js';

/** Transazione Drizzle sullo stesso schema del database. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Ciò che repository e servizi usano per parlare con il DB: il database o una transazione.
 * Nei test di integrazione si passa una transazione che viene annullata alla fine.
 */
export type DbExecutor = Database | Transaction;

/** Numero di righe toccate da un UPDATE/DELETE (`changes` di `node:sqlite`, vedi db/client.ts). */
export function affectedRows(result: unknown): number {
  return (result as { changes?: number } | undefined)?.changes ?? 0;
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function toIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
