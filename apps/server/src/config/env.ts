import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, 'Deve essere 32 byte in base64');

/** Una variabile lasciata vuota nel .env (`NOME=`) vale come assente. */
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  /** File SQLite del database (creato al primo avvio). Relativo alla cartella da cui si avvia. */
  DATABASE_PATH: z.string().min(1).default('data/prisma.db'),
  API_TOKEN: z.string().min(32, 'Usa almeno 32 caratteri (openssl rand -hex 32)'),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SCHEDULER_POLL_MS: z.coerce.number().int().min(1000).default(5000),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  // LinkedIn: senza client id/secret il collegamento dell'account risponde 503.
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.url().default('http://localhost:4000/oauth/linkedin/callback'),
  /** Versione dell'API REST (YYYYMM): ogni versione è supportata per almeno un anno. */
  LINKEDIN_API_VERSION: z
    .string()
    .regex(/^\d{6}$/, 'Formato YYYYMM')
    .default('202611'),
  // Instagram (Business Login for Instagram): senza app id/segreto il collegamento risponde 503.
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: z.url().default('http://localhost:4000/oauth/instagram/callback'),
  /** Versione della Graph API di graph.instagram.com. */
  INSTAGRAM_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Formato vNN.N')
    .default('v27.0'),
  // Cloudflare R2 (S3): senza queste variabili il caricamento dei file risponde 503.
  /** Raccolta delle metriche (fase 4): un giro ogni ora salvo diversa indicazione. */
  ANALYTICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ANALYTICS_POLL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(60 * 60_000),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.url().default('http://localhost:4000/oauth/youtube/callback'),
  /** Categoria dei video caricati (28 = Scienza e tecnologia). */
  YOUTUBE_CATEGORY_ID: z.string().regex(/^\d+$/).default('28'),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  /** Login Kit vuole un indirizzo https registrato nell'app (niente localhost in http). */
  TIKTOK_REDIRECT_URI: z.url().default('https://localhost:4000/oauth/tiktok/callback'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** Indirizzo pubblico del bucket (dominio collegato o r2.dev), senza "/" finale. Serve a Instagram. */
  R2_PUBLIC_BASE_URL: optionalUrl,
  /** Solo per bucket con giurisdizione (es. https://<id>.eu.r2.cloudflarestorage.com). */
  R2_ENDPOINT: optionalUrl,
});

export type Env = z.infer<typeof EnvSchema>;

/** Valida le variabili d'ambiente; elenca tutti i problemi insieme invece di fermarsi al primo. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // Uno spazio dopo l'«=» del .env (es. `DEEPSEEK_API_KEY= sk-…`) renderebbe la chiave non valida.
  const trimmed = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value?.trim()]),
  );
  const result = EnvSchema.safeParse(trimmed);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configurazione non valida:\n${problems}`);
  }
  return result.data;
}

/** Radice del monorepo (dove stanno .env e la cartella data/ del server da solo). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

/** Carica il .env alla radice del monorepo, se esiste. Le variabili già impostate hanno la precedenza. */
export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(process.cwd(), '.env'), resolve(here, '../../../../.env')];
  const file = candidates.find((path) => existsSync(path));
  if (file) process.loadEnvFile(file);
}
