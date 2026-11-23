import {
  APP_CREDENTIAL_KEYS,
  OAuthAppInputSchema,
  R2InputSchema,
  type AppCredentialKey,
  type AppCredentialView,
  type OAuthApp,
} from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { appCredentials } from '../../db/schema.js';
import { BusinessRuleError, NotConfiguredError } from '../../http/error-handler.js';

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
  endpoint?: string;
}

export interface SavedCredentials {
  linkedin?: OAuthAppCredentials;
  instagram?: OAuthAppCredentials;
  youtube?: OAuthAppCredentials;
  tiktok?: OAuthAppCredentials;
  r2?: R2Credentials;
}

const context = (key: AppCredentialKey) => tokenContext('app', key);

/** Credenziali salvate nelle Impostazioni, decifrate (al momento di costruire il runtime). */
export async function loadSavedCredentials(
  db: DbExecutor,
  cipher: TokenCipher,
): Promise<SavedCredentials> {
  const rows = await db.select().from(appCredentials);
  const saved: Record<string, unknown> = {};
  for (const row of rows) {
    if (!(APP_CREDENTIAL_KEYS as readonly string[]).includes(row.key)) continue;
    saved[row.key] = JSON.parse(cipher.decrypt(row.dataEnc, context(row.key as AppCredentialKey)));
  }
  return saved as SavedCredentials;
}

/**
 * Le credenziali salvate hanno la precedenza sul .env: si sovrappongono alle variabili da cui il
 * runtime costruisce OAuth e R2, così il resto del codice non cambia.
 */
export function applySavedCredentials(env: Env, saved: SavedCredentials): Env {
  const next = { ...env };
  if (saved.linkedin) {
    next.LINKEDIN_CLIENT_ID = saved.linkedin.clientId;
    next.LINKEDIN_CLIENT_SECRET = saved.linkedin.clientSecret;
  }
  if (saved.instagram) {
    next.INSTAGRAM_APP_ID = saved.instagram.clientId;
    next.INSTAGRAM_APP_SECRET = saved.instagram.clientSecret;
  }
  if (saved.youtube) {
    next.YOUTUBE_CLIENT_ID = saved.youtube.clientId;
    next.YOUTUBE_CLIENT_SECRET = saved.youtube.clientSecret;
  }
  if (saved.tiktok) {
    next.TIKTOK_CLIENT_KEY = saved.tiktok.clientId;
    next.TIKTOK_CLIENT_SECRET = saved.tiktok.clientSecret;
  }
  if (saved.r2) {
    next.R2_ACCOUNT_ID = saved.r2.accountId;
    next.R2_ACCESS_KEY_ID = saved.r2.accessKeyId;
    next.R2_SECRET_ACCESS_KEY = saved.r2.secretAccessKey;
    next.R2_BUCKET = saved.r2.bucket;
    next.R2_PUBLIC_BASE_URL = saved.r2.publicBaseUrl;
    next.R2_ENDPOINT = saved.r2.endpoint;
  }
  return next;
}

/** Valori del .env (ripiego) per la vista: solo l'identificativo pubblico e se c'è il segreto. */
function envView(
  env: Env,
  key: AppCredentialKey,
): Pick<AppCredentialView, 'publicId' | 'hasSecret' | 'r2'> | null {
  const pair = (id?: string, secret?: string) =>
    id?.trim() ? { publicId: id.trim(), hasSecret: Boolean(secret?.trim()), r2: null } : null;
  switch (key) {
    case 'linkedin':
      return pair(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET);
    case 'instagram':
      return pair(env.INSTAGRAM_APP_ID, env.INSTAGRAM_APP_SECRET);
    case 'youtube':
      return pair(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET);
    case 'tiktok':
      return pair(env.TIKTOK_CLIENT_KEY, env.TIKTOK_CLIENT_SECRET);
    case 'r2':
      return env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID
        ? {
            publicId: env.R2_ACCESS_KEY_ID,
            hasSecret: Boolean(env.R2_SECRET_ACCESS_KEY),
            r2: {
              accountId: env.R2_ACCOUNT_ID,
              bucket: env.R2_BUCKET,
              publicBaseUrl: env.R2_PUBLIC_BASE_URL ?? null,
              endpoint: env.R2_ENDPOINT ?? null,
            },
          }
        : null;
  }
}

export interface AppCredentialsConfig {
  cipher: TokenCipher;
  /** Variabili del server (ripiego quando nelle Impostazioni non c'è nulla). */
  env: Env;
  /** Indirizzi di ritorno del login, da registrare nelle app delle piattaforme. */
  redirects: Record<OAuthApp, string>;
  /** Le credenziali sono cambiate: il runtime si ricostruisce per usarle. */
  onChanged?: () => void;
}

/**
 * Impostazioni › Account: app sviluppatore di ogni piattaforma e archivio R2. Il segreto si
 * scrive ma non si legge: per cambiarlo si reinserisce, lasciarlo vuoto tiene quello salvato.
 */
export function createAppCredentialsService(deps: {
  db: DbExecutor;
  config: AppCredentialsConfig | null;
}) {
  function requireConfig(): AppCredentialsConfig {
    if (!deps.config) throw new NotConfiguredError('Cifratura non configurata sul server');
    return deps.config;
  }

  async function readSaved(
    key: AppCredentialKey,
  ): Promise<{ data: unknown; updatedAt: Date } | null> {
    const { cipher } = requireConfig();
    const [row] = await deps.db.select().from(appCredentials).where(eq(appCredentials.key, key));
    return row
      ? { data: JSON.parse(cipher.decrypt(row.dataEnc, context(key))), updatedAt: row.updatedAt }
      : null;
  }

  async function view(key: AppCredentialKey): Promise<AppCredentialView> {
    const config = requireConfig();
    const redirectUri = key === 'r2' ? null : config.redirects[key];
    const saved = await readSaved(key);
    if (saved) {
      const data = saved.data as Partial<OAuthAppCredentials & R2Credentials>;
      return {
        key,
        source: 'impostazioni',
        publicId: key === 'r2' ? (data.accessKeyId ?? null) : (data.clientId ?? null),
        hasSecret: Boolean(key === 'r2' ? data.secretAccessKey : data.clientSecret),
        redirectUri,
        r2:
          key === 'r2'
            ? {
                accountId: data.accountId ?? '',
                bucket: data.bucket ?? '',
                publicBaseUrl: data.publicBaseUrl ?? null,
                endpoint: data.endpoint ?? null,
              }
            : null,
        updatedAt: saved.updatedAt.toISOString(),
      };
    }
    const fromEnv = envView(config.env, key);
    return fromEnv
      ? { key, source: 'env', redirectUri, updatedAt: null, ...fromEnv }
      : {
          key,
          source: 'nessuna',
          publicId: null,
          hasSecret: false,
          redirectUri,
          r2: null,
          updatedAt: null,
        };
  }

  async function write(key: AppCredentialKey, data: object): Promise<void> {
    const { cipher } = requireConfig();
    const dataEnc = cipher.encrypt(JSON.stringify(data), context(key));
    await deps.db
      .insert(appCredentials)
      .values({ key, dataEnc })
      .onConflictDoUpdate({ target: appCredentials.key, set: { dataEnc, updatedAt: new Date() } });
  }

  return {
    list: async (): Promise<AppCredentialView[]> =>
      Promise.all(APP_CREDENTIAL_KEYS.map((key) => view(key))),

    async save(key: AppCredentialKey, body: unknown): Promise<AppCredentialView> {
      const config = requireConfig();
      const previous = (await readSaved(key))?.data as
        Partial<OAuthAppCredentials & R2Credentials> | undefined;
      if (key === 'r2') {
        const input = R2InputSchema.parse(body);
        const secretAccessKey = input.secretAccessKey || previous?.secretAccessKey;
        if (!secretAccessKey) throw new BusinessRuleError('Inserisci la Secret Access Key di R2');
        await write(key, { ...input, secretAccessKey });
      } else {
        const input = OAuthAppInputSchema.parse(body);
        // Un segreto vecchio vale solo per la stessa app (stesso client id).
        const kept = previous?.clientId === input.clientId ? previous.clientSecret : undefined;
        const clientSecret = input.clientSecret || kept;
        if (!clientSecret) throw new BusinessRuleError('Inserisci il segreto dell’app');
        await write(key, { clientId: input.clientId, clientSecret });
      }
      config.onChanged?.();
      return view(key);
    },

    async remove(key: AppCredentialKey): Promise<AppCredentialView> {
      const config = requireConfig();
      await deps.db.delete(appCredentials).where(eq(appCredentials.key, key));
      config.onChanged?.();
      return view(key);
    },
  };
}

export type AppCredentialsService = ReturnType<typeof createAppCredentialsService>;
