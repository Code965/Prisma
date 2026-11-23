import type { Platform, Variant, VariantAsset } from '@prisma-app/shared';

export interface ValidationIssue {
  /**
   * `error` blocca la pubblicazione, `warning` viene solo mostrato in coda,
   * `ok` è un requisito verificato (mostrato in coda come conferma).
   */
  level: 'ok' | 'warning' | 'error';
  message: string;
}

export interface PublishAccount {
  id: number;
  externalId: string;
  accessToken: string;
}

/** File della variant (export del carosello) con lo stato del caricamento su R2. */
export type PublishMedia = VariantAsset;

/** Carica i file di una variant: lo usano scheduler e controlli della coda. */
export type MediaLoader = (variantId: number) => Promise<PublishMedia[]>;

export const NO_MEDIA: MediaLoader = async () => [];

/**
 * Stato di un caricamento a più passi salvato sulla pubblicazione (es. la sessione resumable di
 * YouTube): un tentativo interrotto riprende da lì invece di caricare un secondo video.
 */
export interface UploadSessionStore {
  get(): string | null;
  save(value: string | null): Promise<void>;
}

export interface PublishRequest {
  publicationId: number;
  /** Da passare alla piattaforma quando la supporta, per evitare doppioni lato API. */
  idempotencyKey: string;
  variant: Variant;
  account: PublishAccount;
  media: PublishMedia[];
  /** Orario programmato (per le piattaforme che caricano in anticipo con uscita programmata). */
  scheduledAt?: Date;
  /** Assente = nessuna sessione da conservare. */
  uploadSession?: UploadSessionStore;
}

export interface PublishResult {
  externalId: string;
  externalUrl: string | null;
  /** Problemi non bloccanti dopo la pubblicazione (es. primo commento non aggiunto). */
  warnings?: string[];
}

export interface MetricSample {
  capturedAt: Date;
  impressions?: number;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  raw: unknown;
}

/**
 * Errore di pubblicazione. `retryable` distingue i problemi temporanei (rete, rate limit,
 * 5xx) da quelli che un nuovo tentativo non risolve (contenuto rifiutato, permessi mancanti).
 */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

/**
 * Caricamento anticipato con uscita programmata gestita dalla piattaforma (YouTube): lo scheduler
 * carica il contenuto quando viene programmato, la pubblicazione resta `programmato` con
 * l'`externalId` e all'orario `finalize` si assicura che sia pubblico.
 */
export interface AdvanceUpload {
  /** Si carica in anticipo solo se mancano almeno questi millisecondi all'uscita. */
  readonly minLeadMs: number;
  prepare(request: PublishRequest & { scheduledAt: Date }): Promise<PublishResult>;
  /** All'orario (o con «Pubblica ora»): rende pubblico il contenuto già caricato. */
  finalize(request: PublishRequest & { externalId: string }): Promise<PublishResult>;
  /** «Annulla»: toglie il contenuto dalla piattaforma prima che esca. */
  withdraw(account: PublishAccount, externalId: string): Promise<void>;
  /** «Sposta»: cambia l'orario di uscita sulla piattaforma. */
  reschedule(account: PublishAccount, externalId: string, scheduledAt: Date): Promise<void>;
}

/** Metriche di un post; `resolved` aggiorna la pubblicazione (TikTok: id e link del post vero). */
export interface PostMetrics extends MetricSample {
  resolved?: { externalId: string; externalUrl: string | null };
}

/** Dati di un account per un giorno: i campi che la piattaforma non dà restano assenti. */
export interface AccountDayMetrics {
  day: string;
  followers?: number;
  followersGained?: number;
  followersLost?: number;
  reach?: number;
  views?: number;
  raw?: unknown;
}

/** La piattaforma non ha ancora dati (post non pubblico, in elaborazione): si riprova più tardi. */
export class MetricsNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricsNotReadyError';
  }
}

export interface PlatformMetrics {
  post(externalId: string, account: PublishAccount): Promise<PostMetrics>;
  /** Giorni da `fromDay` a `toDay` inclusi (YYYY-MM-DD); i follower totali solo per `toDay`. */
  account(account: PublishAccount, fromDay: string, toDay: string): Promise<AccountDayMetrics[]>;
}

export interface PublisherAdapter {
  readonly platform: Platform;
  /** `media` assente equivale a nessun file (i post di solo testo non ne hanno). */
  validate(variant: Variant, media?: readonly PublishMedia[]): ValidationIssue[];
  publish(request: PublishRequest): Promise<PublishResult>;
  advance?: AdvanceUpload;
  /** Metriche dalla piattaforma (fase 4); assente dove l'API non le espone (LinkedIn, blog). */
  metrics?: PlatformMetrics;
}

export type PublisherRegistry = ReadonlyMap<Platform, PublisherAdapter>;

export function createPublisherRegistry(adapters: readonly PublisherAdapter[]): PublisherRegistry {
  return new Map(adapters.map((adapter) => [adapter.platform, adapter]));
}
