import { z } from 'zod';
import { InvalidTransitionError } from './errors.js';

export const VARIANT_STATUSES = [
  'bozza',
  'da_approvare',
  'approvato',
  'programmato',
  'in_pubblicazione',
  'pubblicato',
  'errore',
] as const;
export const VariantStatusSchema = z.enum(VARIANT_STATUSES);
export type VariantStatus = z.infer<typeof VariantStatusSchema>;

export const VARIANT_ACTIONS = [
  'edit',
  'submit',
  'approve',
  'reject',
  'schedule',
  'unschedule',
  'startPublishing',
  'publishSucceeded',
  'publishFailed',
  'retryLater',
  'retry',
] as const;
export const VariantActionSchema = z.enum(VARIANT_ACTIONS);
export type VariantAction = z.infer<typeof VariantActionSchema>;

/**
 * Transizioni ammesse. Regola fondamentale: si arriva a `programmato` solo da `approvato`
 * (o ritentando un errore, che era già stato approvato), e ogni modifica al testo riporta a `bozza`.
 */
const TRANSITIONS: Record<VariantStatus, Partial<Record<VariantAction, VariantStatus>>> = {
  bozza: { edit: 'bozza', submit: 'da_approvare' },
  da_approvare: { edit: 'bozza', approve: 'approvato', reject: 'bozza' },
  approvato: { edit: 'bozza', schedule: 'programmato' },
  programmato: { unschedule: 'approvato', startPublishing: 'in_pubblicazione' },
  in_pubblicazione: {
    publishSucceeded: 'pubblicato',
    publishFailed: 'errore',
    retryLater: 'programmato',
  },
  errore: { edit: 'bozza', retry: 'programmato', unschedule: 'approvato' },
  pubblicato: {},
};

export function nextVariantStatus(from: VariantStatus, action: VariantAction): VariantStatus {
  const to = TRANSITIONS[from][action];
  if (!to) throw new InvalidTransitionError('variant', from, action);
  return to;
}

export function canTransitionVariant(from: VariantStatus, action: VariantAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

export function availableVariantActions(from: VariantStatus): VariantAction[] {
  return VARIANT_ACTIONS.filter((action) => canTransitionVariant(from, action));
}

/** Il testo e i metadata si possono modificare solo dove `edit` è ammesso. */
export function isVariantEditable(status: VariantStatus): boolean {
  return canTransitionVariant(status, 'edit');
}
