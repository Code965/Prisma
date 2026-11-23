import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CORE_DATABASE } from './core.js';
import type {
  ConnectionMode,
  ConnectionSettingsInput,
  ConnectionSettingsView,
} from './ipc-contract.js';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:4000';

interface StoredSettings {
  /** Assente nelle impostazioni salvate prima del passo 5c: vale `locale`. */
  mode?: ConnectionMode;
  serverUrl: string;
  /** Token API cifrato con safeStorage (DPAPI su Windows), in base64. */
  apiTokenEnc?: string;
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function readStored(): StoredSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<StoredSettings>;
    return {
      mode: parsed.mode === 'remoto' ? 'remoto' : 'locale',
      serverUrl: parsed.serverUrl ?? DEFAULT_SERVER_URL,
      apiTokenEnc: parsed.apiTokenEnc,
    };
  } catch {
    return { serverUrl: DEFAULT_SERVER_URL };
  }
}

/**
 * Solo in sviluppo: se non c'è un token salvato si usa `API_TOKEN` del .env alla radice del
 * monorepo, così l'app si collega subito al server locale.
 */
function devTokenFromEnv(): string | null {
  if (app.isPackaged) return null;
  const envFile = resolve(app.getAppPath(), '../../.env');
  if (!existsSync(envFile)) return null;
  const match = /^API_TOKEN=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
  return match?.[1]?.trim() || null;
}

function decryptToken(stored: StoredSettings): string | null {
  if (!stored.apiTokenEnc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored.apiTokenEnc, 'base64'));
  } catch {
    return null;
  }
}

/** Modalità letta all'avvio: è quella in uso finché l'app non si riavvia. */
let activeMode: ConnectionMode | null = null;

export function startupMode(): ConnectionMode {
  activeMode ??= readStored().mode ?? 'locale';
  return activeMode;
}

export function getConnection(): { serverUrl: string; apiToken: string | null } {
  const stored = readStored();
  return { serverUrl: stored.serverUrl, apiToken: decryptToken(stored) ?? devTokenFromEnv() };
}

export function getSettingsView(): ConnectionSettingsView {
  const stored = readStored();
  const saved = decryptToken(stored);
  const fromEnv = saved ? null : devTokenFromEnv();
  const mode = stored.mode ?? 'locale';
  return {
    mode,
    activeMode: startupMode(),
    serverUrl: stored.serverUrl,
    hasToken: Boolean(saved ?? fromEnv),
    tokenSource: saved ? 'salvato' : fromEnv ? 'env-sviluppo' : 'assente',
    databasePath: join(app.getPath('userData'), CORE_DATABASE),
  };
}

export function saveSettings(input: ConnectionSettingsInput): ConnectionSettingsView {
  const stored = readStored();
  const next: StoredSettings = {
    ...stored,
    mode: input.mode ?? 'locale',
    serverUrl: input.serverUrl.replace(/\/+$/, ''),
  };
  if (input.apiToken) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Archivio credenziali del sistema non disponibile: token non salvato');
    }
    next.apiTokenEnc = safeStorage.encryptString(input.apiToken).toString('base64');
  }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return getSettingsView();
}
