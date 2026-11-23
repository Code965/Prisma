import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from './errors.js';
import {
  PUBLICATION_ACTIONS,
  PUBLICATION_STATUSES,
  PUBLICATION_TO_VARIANT_ACTION,
  canTransitionPublication,
  isPublicationFinal,
  nextPublicationStatus,
  type PublicationStatus,
} from './publication-state.js';
import { canTransitionVariant, nextVariantStatus, type VariantStatus } from './variant-state.js';

/** Stato della Variant corrispondente a ogni stato non finale della Publication. */
const VARIANT_FOR: Partial<Record<PublicationStatus, VariantStatus>> = {
  programmato: 'programmato',
  in_pubblicazione: 'in_pubblicazione',
  errore: 'errore',
};

describe('macchina a stati della Publication', () => {
  it('va da programmato a pubblicato', () => {
    expect(nextPublicationStatus(nextPublicationStatus('programmato', 'start'), 'succeed')).toBe(
      'pubblicato',
    );
  });

  it('torna a programmato per un errore temporaneo e va in errore dopo l’ultimo tentativo', () => {
    expect(nextPublicationStatus('in_pubblicazione', 'retryLater')).toBe('programmato');
    expect(nextPublicationStatus('in_pubblicazione', 'fail')).toBe('errore');
  });

  it('non si può annullare mentre è in pubblicazione', () => {
    expect(() => nextPublicationStatus('in_pubblicazione', 'cancel')).toThrow(
      InvalidTransitionError,
    );
  });

  it('pubblicato e annullato sono finali', () => {
    for (const status of ['pubblicato', 'annullato'] as const) {
      expect(isPublicationFinal(status)).toBe(true);
      expect(PUBLICATION_ACTIONS.some((a) => canTransitionPublication(status, a))).toBe(false);
    }
  });

  it('ogni transizione ammessa ha una transizione coerente sulla Variant', () => {
    for (const from of PUBLICATION_STATUSES) {
      const variantFrom = VARIANT_FOR[from];
      for (const action of PUBLICATION_ACTIONS) {
        if (!canTransitionPublication(from, action)) continue;
        expect(variantFrom, `stato variant per ${from}`).toBeDefined();
        const variantAction = PUBLICATION_TO_VARIANT_ACTION[action];
        expect(canTransitionVariant(variantFrom!, variantAction)).toBe(true);

        const pubTo = nextPublicationStatus(from, action);
        const variantTo = nextVariantStatus(variantFrom!, variantAction);
        const expected = pubTo === 'annullato' ? 'approvato' : pubTo;
        expect(variantTo).toBe(expected);
      }
    }
  });
});
