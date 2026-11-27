import {
  IDEA_SOURCES,
  IDEA_STATUSES,
  PLATFORMS,
  PUBLICATION_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  VARIANT_FORMATS,
  VARIANT_STATUSES,
  type BrandKit,
  type Platform,
  type VariantMetadata,
  METRIC_SOURCES,
  type InsightTip,
  type Trend,
  type TrendItem,
  type TrendSourceStatus,
  AI_PRESETS,
} from '@prisma-app/shared';
import {
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// --- Colonne comuni -------------------------------------------------------------------------
// SQLite: interi per id e numeri, testo per stringhe ed enum (controllati da Zod e dai tipi),
// JSON come testo, date come millisecondi UTC.

/** BLOB letto come Buffer (`node:sqlite` restituisce Uint8Array). */
const bytes = customType<{ data: Buffer; driverData: Uint8Array; config: { length?: number } }>({
  dataType: () => 'blob',
  fromDriver: (value) => Buffer.from(value),
  toDriver: (value) => value,
});

const id = () => integer('id').primaryKey({ autoIncrement: true });

const ref = (name: string) => integer(name);

/** Tutte le date sono UTC con millisecondi. */
const instant = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** Testo con un insieme chiuso di valori. */
const choice = <const T extends readonly [string, ...string[]]>(name: string, values: T) =>
  text(name, { enum: values });

const varchar = (name: string, _config?: { length: number }) => text(name);

const json = (name: string) => text(name, { mode: 'json' });

const int = (name: string, _config?: { unsigned: boolean }) => integer(name);

const timestamps = {
  createdAt: instant('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: instant('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

const platform = () => choice('platform', PLATFORMS).notNull();

// --- Brand e account ------------------------------------------------------------------------

export const brands = sqliteTable('brands', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  initials: varchar('initials', { length: 3 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Europe/Rome'),
  /** Brand kit (colori, handle, logo, regole della voce); null = valori predefiniti. */
  kit: json('kit').$type<BrandKit>(),
  ...timestamps,
});

/** Post dell'autore che l'LLM deve imitare (sezione «Voce» di Template e brand kit). */
export const voiceExamples = sqliteTable(
  'voice_examples',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    platform: platform(),
    text: text('text').notNull(),
    note: varchar('note', { length: 200 }).notNull().default(''),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('voice_examples_brand').on(t.brandId, t.createdAt)],
);

export const socialAccounts = sqliteTable(
  'social_accounts',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id),
    platform: platform(),
    externalId: varchar('external_id', { length: 191 }).notNull(),
    handle: varchar('handle', { length: 191 }),
    displayName: varchar('display_name', { length: 191 }).notNull(),
    /** AES-256-GCM: iv | authTag | ciphertext. */
    accessTokenEnc: bytes('access_token_enc', { length: 4096 }).notNull(),
    refreshTokenEnc: bytes('refresh_token_enc', { length: 4096 }),
    tokenExpiresAt: instant('token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scopes: varchar('scopes', { length: 1024 }).notNull().default(''),
    status: choice('status', SOCIAL_ACCOUNT_STATUSES).notNull().default('collegato'),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('social_accounts_brand_platform_ext').on(t.brandId, t.platform, t.externalId),
  ],
);

// --- Idee -----------------------------------------------------------------------------------

export const tags = sqliteTable(
  'tags',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id),
    name: varchar('name', { length: 40 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('tags_brand_name').on(t.brandId, t.name)],
);

export const ideas = sqliteTable(
  'ideas',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id),
    text: text('text').notNull(),
    source: choice('source', IDEA_SOURCES).notNull().default('scritta'),
    status: choice('status', IDEA_STATUSES).notNull().default('nuova'),
    targetPlatforms: json('target_platforms').$type<Platform[]>().notNull(),
    ...timestamps,
  },
  (t) => [index('ideas_brand_status').on(t.brandId, t.status)],
);

export const ideaTags = sqliteTable(
  'idea_tags',
  {
    ideaId: ref('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    tagId: ref('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.tagId] })],
);

// --- Contenuti e variant --------------------------------------------------------------------

export const contents = sqliteTable(
  'contents',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id),
    ideaId: ref('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    ...timestamps,
  },
  (t) => [index('contents_brand').on(t.brandId)],
);

export const variants = sqliteTable(
  'variants',
  {
    id: id(),
    contentId: ref('content_id')
      .notNull()
      .references(() => contents.id, { onDelete: 'cascade' }),
    platform: platform(),
    format: choice('format', VARIANT_FORMATS).notNull(),
    body: text('body').notNull(),
    metadata: json('metadata').$type<VariantMetadata>().notNull(),
    status: choice('status', VARIANT_STATUSES).notNull().default('bozza'),
    /** Lock ottimistico: incrementata a ogni modifica o transizione. */
    version: int('version', { unsigned: true }).notNull().default(0),
    approvedAt: instant('approved_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('variants_content_platform').on(t.contentId, t.platform),
    index('variants_status').on(t.status),
  ],
);

export const variantRevisions = sqliteTable(
  'variant_revisions',
  {
    id: id(),
    variantId: ref('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    metadata: json('metadata').$type<VariantMetadata>().notNull(),
    source: choice('source', ['llm_generate', 'llm_edit', 'manuale']).notNull(),
    /** Istruzione data all'LLM (es. "accorcia l'inizio"), se presente. */
    instruction: text('instruction'),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('variant_revisions_variant').on(t.variantId, t.createdAt)],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: id(),
    contentId: ref('content_id')
      .notNull()
      .references(() => contents.id, { onDelete: 'cascade' }),
    variantId: ref('variant_id').references(() => variants.id, { onDelete: 'set null' }),
    role: choice('role', ['user', 'assistant']).notNull(),
    text: text('text').notNull(),
    revisionId: ref('revision_id').references(() => variantRevisions.id, { onDelete: 'set null' }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('chat_messages_content').on(t.contentId, t.createdAt)],
);

// --- Asset e template -----------------------------------------------------------------------

export const assets = sqliteTable(
  'assets',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id),
    kind: choice('kind', ['image', 'pdf', 'video', 'audio']).notNull(),
    localPath: varchar('local_path', { length: 1024 }),
    remoteKey: varchar('remote_key', { length: 512 }),
    remoteUrl: varchar('remote_url', { length: 1024 }),
    mime: varchar('mime', { length: 127 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    width: int('width', { unsigned: true }),
    height: int('height', { unsigned: true }),
    durationMs: int('duration_ms', { unsigned: true }),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    ...timestamps,
  },
  (t) => [index('assets_brand_checksum').on(t.brandId, t.checksumSha256)],
);

export const variantAssets = sqliteTable(
  'variant_assets',
  {
    variantId: ref('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    assetId: ref('asset_id')
      .notNull()
      .references(() => assets.id),
    position: int('position').notNull().default(0),
    role: choice('role', ['media', 'copertina']).notNull().default('media'),
    /** sha256 di `renderInputKey` per i file disegnati dal carosello (export); null per gli altri. */
    renderHash: varchar('render_hash', { length: 64 }),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.assetId, t.role] })],
);

export const templates = sqliteTable('templates', {
  id: id(),
  brandId: ref('brand_id').references(() => brands.id),
  kind: choice('kind', [
    'carosello',
    'post',
    'citazione',
    'codice',
    'miniatura_yt',
    'copertina_verticale',
  ]).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  dataSchema: json('data_schema').notNull(),
  ...timestamps,
});

// --- Pubblicazioni --------------------------------------------------------------------------

export const publications = sqliteTable(
  'publications',
  {
    id: id(),
    variantId: ref('variant_id')
      .notNull()
      .references(() => variants.id),
    socialAccountId: ref('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    scheduledAt: instant('scheduled_at').notNull(),
    status: choice('status', PUBLICATION_STATUSES).notNull().default('programmato'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    /** Prossimo istante utile per il worker: scheduled_at, poi spostato dal backoff. */
    nextAttemptAt: instant('next_attempt_at'),
    lockedBy: varchar('locked_by', { length: 64 }),
    lockedAt: instant('locked_at'),
    /** Univoca: impedisce di pubblicare due volte la stessa variant sullo stesso account. */
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    externalId: varchar('external_id', { length: 255 }),
    externalUrl: varchar('external_url', { length: 1024 }),
    lastError: text('last_error'),
    publishedAt: instant('published_at'),
    /**
     * Caricamento a più passi in corso (sessione resumable di YouTube): un tentativo interrotto
     * riprende da qui invece di caricare un secondo video.
     */
    uploadSession: varchar('upload_session', { length: 2048 }),
    /** Ultimo tentativo di caricamento anticipato (YouTube con uscita programmata). */
    preparedAt: instant('prepared_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('publications_idempotency_key').on(t.idempotencyKey),
    index('publications_due').on(t.status, t.nextAttemptAt),
    index('publications_variant').on(t.variantId),
    index('publications_scheduled').on(t.scheduledAt),
  ],
);

export const publicationAttempts = sqliteTable(
  'publication_attempts',
  {
    id: id(),
    publicationId: ref('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    attemptNo: int('attempt_no').notNull(),
    startedAt: instant('started_at').notNull(),
    finishedAt: instant('finished_at'),
    outcome: choice('outcome', ['successo', 'errore_temporaneo', 'errore_definitivo']),
    error: text('error'),
  },
  (t) => [uniqueIndex('publication_attempts_pub_no').on(t.publicationId, t.attemptNo)],
);

// --- Metriche -------------------------------------------------------------------------------

export const metricSnapshots = sqliteTable(
  'metric_snapshots',
  {
    id: id(),
    publicationId: ref('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    capturedAt: instant('captured_at').notNull(),
    impressions: int('impressions', { unsigned: true }),
    reach: int('reach', { unsigned: true }),
    views: int('views', { unsigned: true }),
    likes: int('likes', { unsigned: true }),
    comments: int('comments', { unsigned: true }),
    shares: int('shares', { unsigned: true }),
    saves: int('saves', { unsigned: true }),
    /** `api` dalla piattaforma, `manuale` inserito dall'autore (LinkedIn). */
    source: choice('source', METRIC_SOURCES).notNull().default('api'),
    raw: json('raw'),
  },
  (t) => [index('metric_snapshots_pub_time').on(t.publicationId, t.capturedAt)],
);

/** Suggerimenti settimanali dell'AI (fase 4d): uno per tipo, in JSON. */
export const analyticsInsights = sqliteTable(
  'analytics_insights',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    /** Lunedì (ora italiana) della settimana a cui si riferiscono. */
    weekStart: varchar('week_start', { length: 10 }).notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    basedOn: int('based_on', { unsigned: true }).notNull(),
    tips: json('tips').$type<InsightTip[]>().notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('analytics_insights_brand_time').on(t.brandId, t.createdAt)],
);

export const accountMetricSnapshots = sqliteTable(
  'account_metric_snapshots',
  {
    id: id(),
    socialAccountId: ref('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    capturedAt: instant('captured_at').notNull(),
    /** Giorno a cui si riferiscono i dati (YYYY-MM-DD, come lo riporta la piattaforma). */
    day: varchar('day', { length: 10 }).notNull(),
    followers: int('followers', { unsigned: true }),
    followersGained: int('followers_gained', { unsigned: true }),
    followersLost: int('followers_lost', { unsigned: true }),
    reach: int('reach', { unsigned: true }),
    views: int('views', { unsigned: true }),
    raw: json('raw'),
  },
  (t) => [
    index('account_metric_snapshots_acc_time').on(t.socialAccountId, t.capturedAt),
    uniqueIndex('account_metric_snapshots_acc_day').on(t.socialAccountId, t.day),
  ],
);

// --- Impostazioni dell'AI ---------------------------------------------------------------------

/**
 * Servizio AI scelto dall'utente (una sola riga, id = 1). La chiave è cifrata come i token delle
 * piattaforme; senza riga si usa il ripiego del .env.
 */
export const aiSettings = sqliteTable('ai_settings', {
  id: integer('id').primaryKey(),
  preset: choice('preset', AI_PRESETS).notNull(),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  model: varchar('model', { length: 200 }).notNull(),
  apiKeyEnc: bytes('api_key_enc', { length: 2048 }),
  ...timestamps,
});

// --- Credenziali delle app delle piattaforme e di R2 ------------------------------------------

/**
 * App sviluppatore dell'utente (LinkedIn, Instagram, YouTube, TikTok) e archivio R2: tutti i
 * campi in un JSON cifrato con `tokenContext('app', key)`. Senza riga si usa il .env del server.
 */
export const appCredentials = sqliteTable('app_credentials', {
  key: text('key').primaryKey(),
  dataEnc: bytes('data_enc').notNull(),
  ...timestamps,
});

// --- Radar dei trend (fase 8a) ---------------------------------------------------------------

/** Parole cercate dal radar per brand (una riga per brand). */
export const trendSettings = sqliteTable('trend_settings', {
  brandId: ref('brand_id')
    .primaryKey()
    .references(() => brands.id, { onDelete: 'cascade' }),
  keywords: json('keywords').$type<string[]>().notNull(),
  ...timestamps,
});

/** Un aggiornamento del radar: contenuti raccolti dalle fonti e trend raggruppati dall'AI. */
export const trendReports = sqliteTable(
  'trend_reports',
  {
    id: id(),
    brandId: ref('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    model: varchar('model', { length: 120 }).notNull(),
    keywords: json('keywords').$type<string[]>().notNull(),
    sources: json('sources').$type<TrendSourceStatus[]>().notNull(),
    items: json('items').$type<TrendItem[]>().notNull(),
    trends: json('trends').$type<Trend[]>().notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('trend_reports_brand_time').on(t.brandId, t.createdAt)],
);
