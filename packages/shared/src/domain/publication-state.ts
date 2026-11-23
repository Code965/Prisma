import { z } from 'zod';
import { InvalidTransitionError } from './errors.js';
import type { VariantAction } from './variant-state.js';

export const PUBLICATION_STATUSES = [
  'programmato',
  'in_pubblicazione',
  'pubblicato',
  'errore',
  'annullato',
] as const;
export const PublicationStatusSchema = z.enum(PUBLICATION_STATUSES);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const PUBLICATION_ACTIONS = [
  'start',
  'succeed',
  'retryLater',
  'fail',
  'retry',
  'cancel',
] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

const TRANSITIONS: Record<
  PublicationStatus,
  Partial<Record<PublicationAction, PublicationStatus>>
> = {
  programmato: { start: 'in_pubblicazione', cancel: 'annullato' },
  in_pubblicazione: { succeed: 'pubblicato', retryLater: 'programmato', fail: 'errore' },
  errore: { retry: 'programmato', cancel: 'annullato' },
  pubblicato: {},
  annullato: {},
};

/** Azione corrispondente sulla Variant, da applicare nella stessa transazione. */
export const PUBLICATION_TO_VARIANT_ACTION: Record<PublicationAction, VariantAction> = {
  start: 'startPublishing',
  succeed: 'publishSucceeded',
  retryLater: 'retryLater',
  fail: 'publishFailed',
  retry: 'retry',
  cancel: 'unschedule',
};

export function nextPublicationStatus(
  from: PublicationStatus,
  action: PublicationAction,
): PublicationStatus {
  const to = TRANSITIONS[from][action];
  if (!to) throw new InvalidTransitionError('publication', from, action);
  return to;
}

export function canTransitionPublication(
  from: PublicationStatus,
  action: PublicationAction,
): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

export function isPublicationFinal(status: PublicationStatus): boolean {
  return status === 'pubblicato' || status === 'annullato';
}
