import { createHash } from 'node:crypto';
import type {
  PublicationAttempt,
  PublicationListQuery,
  PublicationView,
  Schedule,
} from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { BusinessRuleError, NotFoundError } from '../../http/error-handler.js';
import { findContentRow } from '../contents/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';
import { findVariantRow } from '../variants/repository.js';
import { applyVariantTransition } from '../variants/transitions.js';
import {
  NO_MEDIA,
  PublishError,
  type MediaLoader,
  type PublisherRegistry,
} from '../../publishers/types.js';
import { loadPublishContext } from '../../scheduler/repository.js';
import type { AccessTokenResolver } from '../social-accounts/tokens.js';
import { queueChecks } from './checks.js';
import * as repo from './repository.js';
import { applyPublicationTransition } from './transitions.js';

/** Tolleranza per orari "adesso" arrivati con qualche secondo di ritardo. */
const PAST_TOLERANCE_MS = 60_000;

/**
 * Chiave stabile per variant, account e versione approvata: due richieste di programmazione
 * della stessa versione producono la stessa chiave e il vincolo univoco ne blocca una.
 */
export function idempotencyKey(variantId: number, accountId: number, version: number): string {
  return createHash('sha256').update(`${variantId}:${accountId}:${version}`).digest('hex');
}

export function createPublicationService(
  db: DbExecutor,
  accounts: SocialAccountService,
  now: () => Date,
  publishers: PublisherRegistry = new Map(),
  loadMedia: MediaLoader = NO_MEDIA,
  accessToken: AccessTokenResolver | null = null,
) {
  async function get(id: number): Promise<PublicationView> {
    const view = await repo.findPublicationView(db, id);
    if (!view) throw new NotFoundError('Pubblicazione', id);
    return view;
  }

  function assertNotInPast(date: Date): void {
    if (date.getTime() < now().getTime() - PAST_TOLERANCE_MS) {
      throw new BusinessRuleError('Non si può programmare un orario già passato');
    }
  }

  async function assertAccountMatchesVariant(variantId: number, accountId: number): Promise<void> {
    const variant = await findVariantRow(db, variantId);
    if (!variant) throw new NotFoundError('Variant', variantId);
    const content = await findContentRow(db, variant.contentId);
    const account = await accounts.get(accountId);
    if (account.platform !== variant.platform) {
      throw new BusinessRuleError(
        `La variant è per ${variant.platform}, l'account per ${account.platform}`,
      );
    }
    if (content && account.brandId !== content.brandId) {
      throw new BusinessRuleError("L'account appartiene a un altro brand");
    }
    if (account.status === 'scollegato') {
      throw new BusinessRuleError("L'account è scollegato: ricollegalo prima di programmare");
    }
  }

  async function schedule(input: Schedule): Promise<PublicationView> {
    const scheduledAt = new Date(input.scheduledAt);
    assertNotInPast(scheduledAt);
    await assertAccountMatchesVariant(input.variantId, input.socialAccountId);

    const id = await db.transaction(async (tx) => {
      // La transizione blocca la variant e accetta solo lo stato `approvato`.
      const variant = await applyVariantTransition(tx, input.variantId, 'schedule', { now: now() });
      return repo.insertPublication(tx, {
        variantId: input.variantId,
        socialAccountId: input.socialAccountId,
        scheduledAt,
        idempotencyKey: idempotencyKey(input.variantId, input.socialAccountId, variant.version - 1),
      });
    });
    return get(id);
  }

  /**
   * Contenuto già caricato in anticipo sulla piattaforma (YouTube con uscita programmata):
   * Annulla e Sposta devono agire anche là, altrimenti il video uscirebbe comunque all'orario
   * vecchio. Se la piattaforma non risponde, in Prisma non cambia nulla.
   */
  async function onPlatform(
    id: number,
    action: (
      advance: NonNullable<ReturnType<PublisherRegistry['get']>>['advance'] & object,
      account: { id: number; externalId: string; accessToken: string },
      externalId: string,
    ) => Promise<void>,
  ): Promise<boolean> {
    const context = await loadPublishContext(db, id);
    if (!context) throw new NotFoundError('Pubblicazione', id);
    const { publication, variant, account } = context;
    if (publication.lockedBy) {
      throw new BusinessRuleError(
        'Caricamento sulla piattaforma in corso: riprova tra qualche minuto',
      );
    }
    const advance = publishers.get(variant.platform)?.advance;
    if (!publication.externalId || !advance || !accessToken) return false;
    try {
      const token = await accessToken(account);
      await action(
        advance,
        { id: account.id, externalId: account.externalId, accessToken: token },
        publication.externalId,
      );
    } catch (error) {
      const message =
        error instanceof PublishError || error instanceof Error ? error.message : String(error);
      throw new BusinessRuleError(message);
    }
    return true;
  }

  async function moveTo(
    id: number,
    scheduledAt: Date,
    options: { now?: boolean } = {},
  ): Promise<PublicationView> {
    const row = await repo.findPublicationRow(db, id);
    if (!row) throw new NotFoundError('Pubblicazione', id);
    if (row.status !== 'programmato') {
      throw new BusinessRuleError(`Una pubblicazione in stato ${row.status} non si può spostare`);
    }
    // «Pubblica ora» non tocca la piattaforma: all'orario lo scheduler rende pubblico il video.
    if (!options.now) {
      await onPlatform(id, (advance, account, externalId) =>
        advance.reschedule(account, externalId, scheduledAt),
      );
    } else if (row.lockedBy) {
      throw new BusinessRuleError(
        'Caricamento sulla piattaforma in corso: riprova tra qualche minuto',
      );
    }
    const moved = await repo.updatePublicationIfStatus(db, id, 'programmato', {
      scheduledAt,
      nextAttemptAt: scheduledAt,
    });
    if (!moved)
      throw new BusinessRuleError('La pubblicazione è appena partita: non si può spostare');
    return get(id);
  }

  return {
    list: (query: PublicationListQuery) => repo.listPublications(db, query),
    /** Requisiti dei post in coda, calcolati con gli stessi adapter dello scheduler. */
    checks: (brandId: number) => queueChecks(db, brandId, publishers, now(), loadMedia),
    get,
    schedule,
    reschedule: (id: number, scheduledAt: string) => {
      const date = new Date(scheduledAt);
      assertNotInPast(date);
      return moveTo(id, date);
    },
    /** "Pubblica ora": la pubblicazione resta approvata, cambia solo l'orario. */
    publishNow: (id: number) => moveTo(id, now(), { now: true }),
    cancel: async (id: number): Promise<PublicationView> => {
      const row = await repo.findPublicationRow(db, id);
      if (!row) throw new NotFoundError('Pubblicazione', id);
      // Il video caricato in anticipo si cancella dalla piattaforma prima di annullare.
      const withdrawn =
        row.status === 'programmato' &&
        (await onPlatform(id, (advance, account, externalId) =>
          advance.withdraw(account, externalId),
        ));
      await db.transaction((tx) =>
        applyPublicationTransition(tx, id, 'cancel', {
          now: now(),
          values: {
            nextAttemptAt: null,
            uploadSession: null,
            ...(withdrawn ? { externalId: null, externalUrl: null } : {}),
          },
        }),
      );
      return get(id);
    },
    /** Riprova manuale dopo un errore definitivo: riparte con tutti i tentativi disponibili. */
    retry: async (id: number): Promise<PublicationView> => {
      const at = now();
      await db.transaction((tx) =>
        applyPublicationTransition(tx, id, 'retry', {
          now: at,
          values: { attempts: 0, nextAttemptAt: at, lastError: null },
        }),
      );
      return get(id);
    },
    attempts: async (id: number): Promise<PublicationAttempt[]> => {
      await get(id);
      return repo.listAttempts(db, id);
    },
  };
}

export type PublicationService = ReturnType<typeof createPublicationService>;
