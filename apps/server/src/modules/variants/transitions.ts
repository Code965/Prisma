import { nextVariantStatus, type Variant, type VariantAction } from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { NotFoundError, VersionConflictError } from '../../http/error-handler.js';
import { findVariantRow, toVariant, updateVariantIfVersion } from './repository.js';

interface TransitionOptions {
  /** Se indicata, la transizione fallisce quando la variant è cambiata dopo la lettura del client. */
  expectedVersion?: number;
  now: Date;
}

/**
 * Unico punto in cui lo stato di una variant cambia. Va chiamato dentro una transazione:
 * blocca la riga, valida la transizione con la macchina a stati condivisa e incrementa la versione.
 */
export async function applyVariantTransition(
  tx: DbExecutor,
  variantId: number,
  action: VariantAction,
  options: TransitionOptions,
): Promise<Variant> {
  const row = await findVariantRow(tx, variantId, { forUpdate: true });
  if (!row) throw new NotFoundError('Variant', variantId);
  if (options.expectedVersion !== undefined && row.version !== options.expectedVersion) {
    throw new VersionConflictError('Variant', variantId);
  }

  const status = nextVariantStatus(row.status, action);
  const approvedAt = approvalDate(action, row.approvedAt, options.now);

  const updated = await updateVariantIfVersion(tx, variantId, row.version, { status, approvedAt });
  if (!updated) throw new VersionConflictError('Variant', variantId);

  return toVariant({ ...row, status, approvedAt, version: row.version + 1 });
}

/** L'approvazione si registra quando avviene e si perde con ogni ritorno a bozza. */
function approvalDate(action: VariantAction, current: Date | null, now: Date): Date | null {
  if (action === 'approve') return now;
  if (action === 'edit' || action === 'reject') return null;
  return current;
}
