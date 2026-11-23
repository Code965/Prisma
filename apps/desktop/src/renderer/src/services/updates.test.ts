import { describe, expect, it } from 'vitest';
import { canCheckUpdates, updateStatusLabel, type UpdateState } from './updates';

const base: UpdateState = { currentVersion: '0.1.0', status: 'inattivo', prompt: false };

describe('stato degli aggiornamenti', () => {
  it('descrive ogni fase', () => {
    expect(updateStatusLabel({ ...base, status: 'download', version: '0.2.0', percent: 40 })).toBe(
      'Scarico la versione 0.2.0 · 40%',
    );
    expect(updateStatusLabel({ ...base, status: 'pronto', version: '0.2.0' })).toMatch(/pronta/);
    expect(updateStatusLabel({ ...base, status: 'errore', error: 'Offline' })).toBe('Offline');
    expect(updateStatusLabel({ ...base, status: 'disattivato' })).toMatch(/sviluppo/);
  });

  it('non avvia una verifica durante un controllo o un download', () => {
    expect(canCheckUpdates(base)).toBe(true);
    expect(canCheckUpdates({ ...base, status: 'download' })).toBe(false);
    expect(canCheckUpdates({ ...base, status: 'disattivato' })).toBe(false);
  });
});
