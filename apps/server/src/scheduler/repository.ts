import type { Platform } from '@prisma-app/shared';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { affectedRows, type DbExecutor } from '../db/executor.js';
import { publicationAttempts, publications, socialAccounts, variants } from '../db/schema.js';

export interface ClaimCandidate {
  id: number;
  attempts: number;
  maxAttempts: number;
}

/**
 * Pubblicazioni scadute da prendere in carico. Il claim avviene in una transazione e con SQLite
 * le transazioni sono una alla volta (db/client.ts): due worker non prendono mai la stessa riga,
 * perché il secondo la trova già `in_pubblicazione`.
 */
export async function selectDueForUpdate(
  tx: DbExecutor,
  now: Date,
  platforms: readonly Platform[],
  limit: number,
): Promise<ClaimCandidate[]> {
  if (platforms.length === 0) return [];
  return tx
    .select({
      id: publications.id,
      attempts: publications.attempts,
      maxAttempts: publications.maxAttempts,
    })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .where(
      and(
        eq(publications.status, 'programmato'),
        lte(publications.nextAttemptAt, now),
        inArray(variants.platform, [...platforms]),
        // Una pubblicazione in caricamento anticipato è bloccata finché il caricamento non finisce.
        isNull(publications.lockedBy),
      ),
    )
    .orderBy(asc(publications.nextAttemptAt), asc(publications.id))
    .limit(limit);
}

/**
 * Pubblicazioni rimaste `in_pubblicazione` oltre la soglia: il worker si è fermato a metà.
 * Come per il claim, un worker recupera solo le piattaforme che sa gestire.
 */
export async function selectStaleForUpdate(
  tx: DbExecutor,
  lockedBefore: Date,
  platforms: readonly Platform[],
  limit: number,
): Promise<{ id: number; attempts: number }[]> {
  if (platforms.length === 0) return [];
  return tx
    .select({ id: publications.id, attempts: publications.attempts })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .where(
      and(
        eq(publications.status, 'in_pubblicazione'),
        lt(publications.lockedAt, lockedBefore),
        inArray(variants.platform, [...platforms]),
      ),
    )
    .limit(limit);
}

export async function insertAttempt(
  tx: DbExecutor,
  publicationId: number,
  attemptNo: number,
  startedAt: Date,
): Promise<void> {
  await tx.insert(publicationAttempts).values({ publicationId, attemptNo, startedAt });
}

export async function finishAttempt(
  tx: DbExecutor,
  publicationId: number,
  attemptNo: number,
  values: {
    finishedAt: Date;
    outcome: 'successo' | 'errore_temporaneo' | 'errore_definitivo';
    error: string | null;
  },
): Promise<void> {
  await tx
    .update(publicationAttempts)
    .set(values)
    .where(
      and(
        eq(publicationAttempts.publicationId, publicationId),
        eq(publicationAttempts.attemptNo, attemptNo),
      ),
    );
}

/** Tutto ciò che serve per inviare una pubblicazione, token cifrato compreso. */
export async function loadPublishContext(db: DbExecutor, publicationId: number) {
  const [row] = await db
    .select({ publication: publications, variant: variants, account: socialAccounts })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publications.socialAccountId))
    .where(eq(publications.id, publicationId));
  return row ?? null;
}

/**
 * Prossima pubblicazione da caricare in anticipo per una piattaforma con uscita programmata:
 * ancora senza `external_id`, abbastanza lontana dall'orario, mai tentata o tentata più di
 * un'ora fa (le quote giornaliere non vanno consumate da un errore che si ripete).
 */
export async function selectPreparableForUpdate(
  tx: DbExecutor,
  platform: Platform,
  now: Date,
  minLeadMs: number,
  retryAfterMs: number,
) {
  const [row] = await tx
    .select({ id: publications.id, scheduledAt: publications.scheduledAt })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .where(
      and(
        eq(publications.status, 'programmato'),
        eq(variants.platform, platform),
        isNull(publications.externalId),
        isNull(publications.lockedBy),
        gt(publications.scheduledAt, new Date(now.getTime() + minLeadMs)),
        or(
          isNull(publications.preparedAt),
          lt(publications.preparedAt, new Date(now.getTime() - retryAfterMs)),
        ),
      ),
    )
    .orderBy(asc(publications.scheduledAt), asc(publications.id))
    .limit(1);
  return row ?? null;
}

/** Sblocca i caricamenti anticipati rimasti a metà (worker fermato): la sessione salvata li riprende. */
export async function releaseStalePrepares(db: DbExecutor, lockedBefore: Date): Promise<number> {
  const result = await db
    .update(publications)
    .set({ lockedBy: null, lockedAt: null })
    .where(and(eq(publications.status, 'programmato'), lt(publications.lockedAt, lockedBefore)));
  return affectedRows(result);
}

export async function updatePublication(
  db: DbExecutor,
  id: number,
  values: Partial<typeof publications.$inferInsert>,
): Promise<void> {
  await db.update(publications).set(values).where(eq(publications.id, id));
}
