import {
  PUBLICATION_TO_VARIANT_ACTION,
  nextPublicationStatus,
  type PublicationAction,
} from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { ConflictError, NotFoundError } from '../../http/error-handler.js';
import { applyVariantTransition } from '../variants/transitions.js';
import {
  findPublicationRow,
  updatePublicationIfStatus,
  type PublicationUpdate,
} from './repository.js';

/**
 * Unico punto in cui lo stato di una pubblicazione cambia. Va chiamato dentro una transazione:
 * aggiorna pubblicazione e variant insieme, così i due stati non divergono mai.
 */
export async function applyPublicationTransition(
  tx: DbExecutor,
  publicationId: number,
  action: PublicationAction,
  options: { now: Date; values?: PublicationUpdate },
): Promise<void> {
  const row = await findPublicationRow(tx, publicationId, { forUpdate: true });
  if (!row) throw new NotFoundError('Pubblicazione', publicationId);

  const status = nextPublicationStatus(row.status, action);
  const updated = await updatePublicationIfStatus(tx, publicationId, row.status, {
    ...options.values,
    status,
  });
  if (!updated) throw new ConflictError('La pubblicazione è cambiata nel frattempo');

  await applyVariantTransition(tx, row.variantId, PUBLICATION_TO_VARIANT_ACTION[action], {
    now: options.now,
  });
}
