import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from './errors.js';
import {
  VARIANT_ACTIONS,
  VARIANT_STATUSES,
  availableVariantActions,
  canTransitionVariant,
  isVariantEditable,
  nextVariantStatus,
  type VariantAction,
  type VariantStatus,
} from './variant-state.js';

describe('macchina a stati della Variant', () => {
  it('percorre il flusso felice fino a pubblicato', () => {
    const steps: VariantAction[] = [
      'submit',
      'approve',
      'schedule',
      'startPublishing',
      'publishSucceeded',
    ];
    const final = steps.reduce<VariantStatus>(
      (status, action) => nextVariantStatus(status, action),
      'bozza',
    );
    expect(final).toBe('pubblicato');
  });

  it('permette di programmare solo una variant approvata', () => {
    const allowed = VARIANT_STATUSES.filter((s) => canTransitionVariant(s, 'schedule'));
    expect(allowed).toEqual(['approvato']);
  });

  it('raggiunge programmato solo da approvato o ritentando un errore', () => {
    const sources = VARIANT_STATUSES.filter((from) =>
      VARIANT_ACTIONS.some(
        (action) =>
          canTransitionVariant(from, action) && nextVariantStatus(from, action) === 'programmato',
      ),
    );
    expect(sources.sort()).toEqual(['approvato', 'errore', 'in_pubblicazione'].sort());
  });

  it('riporta a bozza qualsiasi modifica, anche su una variant approvata', () => {
    expect(nextVariantStatus('approvato', 'edit')).toBe('bozza');
    expect(nextVariantStatus('da_approvare', 'edit')).toBe('bozza');
    expect(nextVariantStatus('errore', 'edit')).toBe('bozza');
  });

  it('non permette modifiche mentre è programmata, in pubblicazione o pubblicata', () => {
    expect(isVariantEditable('programmato')).toBe(false);
    expect(isVariantEditable('in_pubblicazione')).toBe(false);
    expect(isVariantEditable('pubblicato')).toBe(false);
  });

  it('non permette di approvare saltando la revisione', () => {
    expect(() => nextVariantStatus('bozza', 'approve')).toThrow(InvalidTransitionError);
  });

  it('annullare una programmazione riporta ad approvato', () => {
    expect(nextVariantStatus('programmato', 'unschedule')).toBe('approvato');
    expect(nextVariantStatus('errore', 'unschedule')).toBe('approvato');
  });

  it('gestisce errore e ritentativo', () => {
    expect(nextVariantStatus('in_pubblicazione', 'publishFailed')).toBe('errore');
    expect(nextVariantStatus('in_pubblicazione', 'retryLater')).toBe('programmato');
    expect(nextVariantStatus('errore', 'retry')).toBe('programmato');
  });

  it('considera pubblicato uno stato finale', () => {
    expect(availableVariantActions('pubblicato')).toEqual([]);
  });

  it('descrive la transizione rifiutata nell’errore', () => {
    try {
      nextVariantStatus('pubblicato', 'edit');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(error).toMatchObject({ entity: 'variant', from: 'pubblicato', action: 'edit' });
    }
  });
});
