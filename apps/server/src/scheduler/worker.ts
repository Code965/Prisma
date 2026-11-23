import { randomUUID } from 'node:crypto';
import type { Platform } from '@prisma-app/shared';
import type { TokenCipher } from '../crypto/token-cipher.js';
import type { DbExecutor } from '../db/executor.js';
import { applyPublicationTransition } from '../modules/publications/transitions.js';
import {
  createAccessTokenResolver,
  type AccessTokenResolver,
} from '../modules/social-accounts/tokens.js';
import { toVariant } from '../modules/variants/repository.js';
import {
  NO_MEDIA,
  PublishError,
  type MediaLoader,
  type PublisherRegistry,
  type PublishRequest,
  type PublishResult,
} from '../publishers/types.js';
import { DEFAULT_BACKOFF, backoffDelayMs, type BackoffOptions } from './backoff.js';
import * as repo from './repository.js';

export interface SchedulerLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

export interface SchedulerOptions {
  db: DbExecutor;
  publishers: PublisherRegistry;
  cipher: TokenCipher;
  /** Token di accesso per account (rinnovati per le piattaforme con refresh token). */
  accessToken?: AccessTokenResolver;
  /** Dopo un caricamento anticipato fallito si riprova non prima di questo intervallo. */
  prepareRetryMs?: number;
  /** File delle variant (caroselli esportati e caricati su R2). */
  loadMedia?: MediaLoader;
  now?: () => Date;
  workerId?: string;
  batchSize?: number;
  /** Oltre questa durata una pubblicazione `in_pubblicazione` è considerata interrotta. */
  staleAfterMs?: number;
  backoff?: BackoffOptions;
  random?: () => number;
  logger?: SchedulerLogger;
}

export interface RunSummary {
  recovered: number;
  /** Caricamenti anticipati riusciti (YouTube con uscita programmata). */
  prepared: number;
  claimed: number;
  published: number;
  retried: number;
  failed: number;
}

interface Claim {
  id: number;
  attemptNo: number;
  maxAttempts: number;
}

type Outcome =
  | { kind: 'success'; result: PublishResult }
  | { kind: 'error'; message: string; retryable: boolean };

export const STALE_MESSAGE =
  'Invio interrotto: il post potrebbe essere già online. Controlla sulla piattaforma prima di usare Riprova.';

const MAX_ERROR_LENGTH = 1000;
const silentLogger: SchedulerLogger = { info() {}, warn() {}, error() {} };

export function createScheduler(options: SchedulerOptions) {
  const {
    db,
    publishers,
    cipher,
    accessToken = createAccessTokenResolver(cipher),
    prepareRetryMs = 60 * 60_000,
    loadMedia = NO_MEDIA,
    now = () => new Date(),
    workerId = `worker-${randomUUID().slice(0, 8)}`,
    batchSize = 5,
    staleAfterMs = 30 * 60_000,
    backoff = DEFAULT_BACKOFF,
    random = Math.random,
    logger = silentLogger,
  } = options;

  const platforms = [...publishers.keys()] as Platform[];

  /** Chiude come errore le pubblicazioni rimaste a metà: non si ripubblica mai alla cieca. */
  async function recoverStale(): Promise<number> {
    const at = now();
    const lockedBefore = new Date(at.getTime() - staleAfterMs);
    // I caricamenti anticipati interrotti si sbloccano soltanto: la sessione salvata li riprende.
    await repo.releaseStalePrepares(db, lockedBefore);
    return db.transaction(async (tx) => {
      const stale = await repo.selectStaleForUpdate(tx, lockedBefore, platforms, batchSize);
      for (const { id, attempts } of stale) {
        await applyPublicationTransition(tx, id, 'fail', {
          now: at,
          values: { lastError: STALE_MESSAGE, lockedBy: null, lockedAt: null, nextAttemptAt: null },
        });
        await repo.finishAttempt(tx, id, attempts, {
          finishedAt: at,
          outcome: 'errore_definitivo',
          error: STALE_MESSAGE,
        });
        logger.warn({ publicationId: id }, 'Pubblicazione interrotta, segnata come errore');
      }
      return stale.length;
    });
  }

  /** Prende in carico le pubblicazioni scadute e le porta a `in_pubblicazione` in un'unica transazione. */
  async function claimDue(): Promise<Claim[]> {
    const at = now();
    return db.transaction(async (tx) => {
      const due = await repo.selectDueForUpdate(tx, at, platforms, batchSize);
      const claims: Claim[] = [];
      for (const candidate of due) {
        const attemptNo = candidate.attempts + 1;
        await applyPublicationTransition(tx, candidate.id, 'start', {
          now: at,
          values: { attempts: attemptNo, lockedBy: workerId, lockedAt: at },
        });
        await repo.insertAttempt(tx, candidate.id, attemptNo, at);
        claims.push({ id: candidate.id, attemptNo, maxAttempts: candidate.maxAttempts });
      }
      return claims;
    });
  }

  /** Richiesta per l'adapter, con il token di accesso e la sessione di caricamento salvata. */
  async function buildRequest(
    context: NonNullable<Awaited<ReturnType<typeof repo.loadPublishContext>>>,
    media: PublishRequest['media'],
  ): Promise<PublishRequest> {
    const { publication, variant, account } = context;
    let session = publication.uploadSession;
    return {
      publicationId: publication.id,
      idempotencyKey: publication.idempotencyKey,
      variant: toVariant(variant),
      account: {
        id: account.id,
        externalId: account.externalId,
        accessToken: await accessToken(account),
      },
      media,
      scheduledAt: publication.scheduledAt,
      uploadSession: {
        get: () => session,
        save: async (value) => {
          session = value;
          await repo.updatePublication(db, publication.id, { uploadSession: value });
        },
      },
    };
  }

  async function attemptPublish(claim: Claim): Promise<Outcome> {
    const context = await repo.loadPublishContext(db, claim.id);
    if (!context) return permanent('Pubblicazione non trovata');
    const { publication, variant, account } = context;
    const adapter = publishers.get(variant.platform);

    // Già caricata: se in anticipo (uscita programmata) la si rende pubblica, altrimenti si
    // registra l'esito di un tentativo precedente senza inviare di nuovo.
    if (publication.externalId) {
      const externalId = publication.externalId;
      const advance = adapter?.advance;
      if (!advance) {
        return { kind: 'success', result: { externalId, externalUrl: publication.externalUrl } };
      }
      return run(async () =>
        advance.finalize({ ...(await buildRequest(context, [])), externalId }),
      );
    }

    if (!adapter) return permanent(`Nessun adapter disponibile per ${variant.platform}`);
    if (account.status === 'scollegato') return permanent("L'account è scollegato");
    if (
      !account.refreshTokenEnc &&
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() <= now().getTime()
    ) {
      return permanent("Il token dell'account è scaduto: ricollega l'account");
    }

    let media;
    try {
      media = await loadMedia(variant.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        kind: 'error',
        message: `File della variant non leggibili: ${detail}`,
        retryable: true,
      };
    }
    const errors = adapter
      .validate(toVariant(variant), media)
      .filter((issue) => issue.level === 'error');
    if (errors.length > 0) return permanent(errors.map((issue) => issue.message).join('; '));

    return run(async () => adapter.publish(await buildRequest(context, media)));
  }

  async function run(action: () => Promise<PublishResult>): Promise<Outcome> {
    try {
      return { kind: 'success', result: await action() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Gli errori non classificati (rete, timeout) si considerano temporanei.
      const retryable = error instanceof PublishError ? error.retryable : true;
      return { kind: 'error', message, retryable };
    }
  }

  /**
   * Caricamento anticipato (YouTube): una pubblicazione per ciclo, perché l'upload è lungo. La
   * riga resta `programmato`, bloccata da questo worker finché il caricamento non finisce.
   */
  async function prepareUpcoming(): Promise<number> {
    for (const adapter of publishers.values()) {
      const advance = adapter.advance;
      if (!advance) continue;
      const at = now();
      const picked = await db.transaction(async (tx) => {
        const row = await repo.selectPreparableForUpdate(
          tx,
          adapter.platform,
          at,
          advance.minLeadMs,
          prepareRetryMs,
        );
        if (row) {
          await repo.updatePublication(tx, row.id, {
            lockedBy: workerId,
            lockedAt: at,
            preparedAt: at,
          });
        }
        return row;
      });
      if (!picked) continue;
      const unlock = { lockedBy: null, lockedAt: null };
      const outcome = await run(async () => {
        const context = await repo.loadPublishContext(db, picked.id);
        if (!context) throw new PublishError('Pubblicazione non trovata', false);
        const media = await loadMedia(context.variant.id);
        const errors = adapter
          .validate(toVariant(context.variant), media)
          .filter((issue) => issue.level === 'error');
        if (errors.length > 0) {
          throw new PublishError(errors.map((issue) => issue.message).join('; '), false);
        }
        const request = await buildRequest(context, media);
        return advance.prepare({ ...request, scheduledAt: picked.scheduledAt });
      });
      if (outcome.kind === 'success') {
        await repo.updatePublication(db, picked.id, {
          ...unlock,
          externalId: outcome.result.externalId,
          externalUrl: outcome.result.externalUrl,
          lastError: null,
        });
        logger.info({ publicationId: picked.id }, 'Caricato in anticipo con uscita programmata');
        return 1;
      }
      await repo.updatePublication(db, picked.id, {
        ...unlock,
        lastError: `Caricamento anticipato non riuscito: ${outcome.message}`.slice(
          0,
          MAX_ERROR_LENGTH,
        ),
      });
      logger.warn(
        { publicationId: picked.id, error: outcome.message },
        'Caricamento anticipato fallito',
      );
    }
    return 0;
  }

  async function settle(
    claim: Claim,
    outcome: Outcome,
  ): Promise<'published' | 'retried' | 'failed'> {
    const at = now();
    const unlock = { lockedBy: null, lockedAt: null };
    return db.transaction(async (tx) => {
      if (outcome.kind === 'success') {
        await applyPublicationTransition(tx, claim.id, 'succeed', {
          now: at,
          values: {
            ...unlock,
            externalId: outcome.result.externalId,
            externalUrl: outcome.result.externalUrl,
            publishedAt: at,
            nextAttemptAt: null,
            lastError: warningText(outcome.result.warnings),
          },
        });
        await repo.finishAttempt(tx, claim.id, claim.attemptNo, {
          finishedAt: at,
          outcome: 'successo',
          error: null,
        });
        return 'published';
      }

      const message = outcome.message.slice(0, MAX_ERROR_LENGTH);
      if (outcome.retryable && claim.attemptNo < claim.maxAttempts) {
        const nextAttemptAt = new Date(
          at.getTime() + backoffDelayMs(claim.attemptNo, backoff, random),
        );
        await applyPublicationTransition(tx, claim.id, 'retryLater', {
          now: at,
          values: { ...unlock, nextAttemptAt, lastError: message },
        });
        await repo.finishAttempt(tx, claim.id, claim.attemptNo, {
          finishedAt: at,
          outcome: 'errore_temporaneo',
          error: message,
        });
        return 'retried';
      }

      await applyPublicationTransition(tx, claim.id, 'fail', {
        now: at,
        values: { ...unlock, nextAttemptAt: null, lastError: message },
      });
      await repo.finishAttempt(tx, claim.id, claim.attemptNo, {
        finishedAt: at,
        outcome: 'errore_definitivo',
        error: message,
      });
      return 'failed';
    });
  }

  async function runOnce(): Promise<RunSummary> {
    const summary: RunSummary = {
      recovered: 0,
      prepared: 0,
      claimed: 0,
      published: 0,
      retried: 0,
      failed: 0,
    };
    summary.recovered = await recoverStale();
    const claims = await claimDue();
    summary.claimed = claims.length;
    // In sequenza: un solo utente, e gli upload video non vanno fatti in parallelo.
    for (const claim of claims) {
      const result = await settle(claim, await attemptPublish(claim));
      summary[result] += 1;
      logger.info(
        { publicationId: claim.id, attempt: claim.attemptNo, result },
        'Pubblicazione elaborata',
      );
    }
    // Prima le uscite dovute, poi un caricamento anticipato (YouTube).
    summary.prepared = await prepareUpcoming();
    return summary;
  }

  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = true;

  function scheduleNext(intervalMs: number): void {
    if (stopped) return;
    timer = setTimeout(() => {
      running = runOnce()
        .catch((error: unknown) => logger.error({ err: error }, 'Ciclo dello scheduler fallito'))
        .finally(() => scheduleNext(intervalMs));
    }, intervalMs);
  }

  return {
    workerId,
    runOnce,
    start(intervalMs: number): void {
      if (!stopped) return;
      stopped = false;
      logger.info({ workerId, platforms, intervalMs }, 'Scheduler avviato');
      scheduleNext(0);
    },
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}

/** Su una pubblicazione riuscita `last_error` contiene solo eventuali avvisi. */
function warningText(warnings: string[] | undefined): string | null {
  if (!warnings?.length) return null;
  return `Avviso: ${warnings.join('; ')}`.slice(0, MAX_ERROR_LENGTH);
}

function permanent(message: string): Outcome {
  return { kind: 'error', message, retryable: false };
}

export type Scheduler = ReturnType<typeof createScheduler>;
