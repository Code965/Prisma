import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from '@prisma-app/server/config';
import { createPrismaRuntime, type PrismaRuntime } from '@prisma-app/server/runtime';
import type { ApiRequest, ApiResponse } from './ipc-contract.js';

/**
 * Prisma «local-first»: lo stesso server dell'API gira dentro il processo principale di Electron,
 * con il database SQLite nella cartella dei dati. Nessuna porta aperta: le richieste del renderer
 * arrivano con `app.inject`, quindi nessun altro programma può usarle.
 */

/** Database dei contenuti (diverso da `prisma.db`, che tiene i progetti video). */
export const CORE_DATABASE = 'contenuti.db';
const KEY_FILE = 'chiave-dati.json';
/** Lasciato dall'importazione da MySQL: la chiave del vecchio server, per leggere i token copiati. */
const IMPORTED_KEY_FILE = 'chiave-importata.txt';

/**
 * Chiave AES-256 dei token e delle chiavi API, conservata cifrata con `safeStorage` (DPAPI su
 * Windows): solo questo utente di Windows la può leggere. Creata al primo avvio, oppure presa
 * dall'importazione da MySQL (poi il file in chiaro si cancella).
 */
function loadOrCreateKey(userDataDir: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Archivio credenziali di Windows non disponibile: impossibile proteggere i dati',
    );
  }
  const keyPath = join(userDataDir, KEY_FILE);
  const importedPath = join(userDataDir, IMPORTED_KEY_FILE);
  const save = (key: string) =>
    writeFileSync(
      keyPath,
      JSON.stringify({ key: safeStorage.encryptString(key).toString('base64') }),
      'utf8',
    );

  if (existsSync(importedPath)) {
    const imported = readFileSync(importedPath, 'utf8').trim();
    if (Buffer.from(imported, 'base64').length === 32) save(imported);
    rmSync(importedPath, { force: true });
  }
  if (existsSync(keyPath)) {
    const { key } = JSON.parse(readFileSync(keyPath, 'utf8')) as { key: string };
    return safeStorage.decryptString(Buffer.from(key, 'base64'));
  }
  const key = randomBytes(32).toString('base64');
  save(key);
  return key;
}

/**
 * Variabili facoltative del .env alla radice del progetto, solo in sviluppo: credenziali delle
 * app delle piattaforme, R2 e il ripiego dell'AI, finché non si potranno inserire nelle
 * Impostazioni (fase 5d). Nell'app installata non c'è nessun .env.
 */
function devEnv(): Record<string, string> {
  if (app.isPackaged) return {};
  const file = resolve(app.getAppPath(), '../../.env');
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]!] = match[2]!.trim();
  }
  // Database, token e chiave del server da solo non valgono per quello dentro l'app.
  for (const own of ['DATABASE_PATH', 'API_TOKEN', 'TOKEN_ENCRYPTION_KEY', 'PORT', 'HOST']) {
    delete values[own];
  }
  return values;
}

export interface Core {
  request(request: ApiRequest): Promise<ApiResponse>;
  stop(): Promise<void>;
}

export async function startCore(userDataDir: string): Promise<Core> {
  // Token interno: serve solo perché l'API lo richiede, non esce mai dal processo.
  const apiToken = randomBytes(32).toString('hex');
  const env = parseEnv({
    ...devEnv(),
    NODE_ENV: 'production',
    DATABASE_PATH: join(userDataDir, CORE_DATABASE),
    API_TOKEN: apiToken,
    TOKEN_ENCRYPTION_KEY: loadOrCreateKey(userDataDir),
  });
  const runtime: PrismaRuntime = await createPrismaRuntime(env, {
    logger: { level: app.isPackaged ? 'warn' : 'info' },
  });
  await runtime.app.ready();
  runtime.startBackground();

  return {
    async request({ method, path, body }) {
      const response = await runtime.app.inject({
        method,
        url: path,
        headers: {
          authorization: `Bearer ${apiToken}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      });
      let parsed: unknown = response.body;
      try {
        parsed = response.body ? JSON.parse(response.body) : null;
      } catch {
        // risposta non JSON (es. pagine HTML delle callback OAuth): il testo così com'è
      }
      return { status: response.statusCode, body: parsed };
    },
    stop: () => runtime.stop(),
  };
}
