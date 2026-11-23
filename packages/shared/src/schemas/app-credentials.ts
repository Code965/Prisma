import { z } from 'zod';

/**
 * Credenziali delle app sviluppatore che ogni utente crea sulle piattaforme (fase 5d), più
 * l'archivio Cloudflare R2. Si inseriscono nelle Impostazioni e il server le tiene cifrate; il
 * segreto non torna mai al desktop.
 */
export const OAUTH_APPS = ['linkedin', 'instagram', 'youtube', 'tiktok'] as const;
export type OAuthApp = (typeof OAUTH_APPS)[number];
export const APP_CREDENTIAL_KEYS = [...OAUTH_APPS, 'r2'] as const;
export type AppCredentialKey = (typeof APP_CREDENTIAL_KEYS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalSecret = z.string().trim().max(2000).optional();

/** `clientSecret` assente = tieni quello salvato. */
export const OAuthAppInputSchema = z.object({
  clientId: text(500),
  clientSecret: optionalSecret,
});
export type OAuthAppInput = z.infer<typeof OAuthAppInputSchema>;

const httpsUrl = z
  .string()
  .trim()
  .pipe(z.url())
  .refine((url) => url.startsWith('https://'), 'Serve un indirizzo https')
  .transform((url) => url.replace(/\/+$/, ''));

/** `secretAccessKey` assente = tieni quella salvata. */
export const R2InputSchema = z.object({
  accountId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i, 'L’Account ID di Cloudflare è di 32 caratteri esadecimali'),
  accessKeyId: text(200),
  secretAccessKey: optionalSecret,
  bucket: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Nome del bucket non valido'),
  /** Indirizzo pubblico del bucket (r2.dev o dominio collegato): serve a Instagram. */
  publicBaseUrl: httpsUrl.optional(),
  /** Solo per bucket con giurisdizione (es. https://<id>.eu.r2.cloudflarestorage.com). */
  endpoint: httpsUrl.optional(),
});
export type R2Input = z.infer<typeof R2InputSchema>;

export const CREDENTIAL_SOURCES = ['impostazioni', 'env', 'nessuna'] as const;

export const AppCredentialViewSchema = z.object({
  key: z.enum(APP_CREDENTIAL_KEYS),
  /** Da dove arrivano: Impostazioni, .env del server o nessuna parte. */
  source: z.enum(CREDENTIAL_SOURCES),
  /** Identificativo pubblico (client id, app id, client key; per R2 l'access key id). */
  publicId: z.string().nullable(),
  hasSecret: z.boolean(),
  /** Indirizzo di ritorno da registrare nell'app della piattaforma (null per R2). */
  redirectUri: z.string().nullable(),
  /** Solo R2. */
  r2: z
    .object({
      accountId: z.string(),
      bucket: z.string(),
      publicBaseUrl: z.string().nullable(),
      endpoint: z.string().nullable(),
    })
    .nullable(),
  updatedAt: z.string().nullable(),
});
export type AppCredentialView = z.infer<typeof AppCredentialViewSchema>;
