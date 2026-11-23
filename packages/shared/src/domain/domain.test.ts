import { describe, expect, it } from 'vitest';
import { PLATFORMS, PLATFORM_FORMATS, defaultFormat, isFormatSupported } from './platforms.js';
import { deriveAccountStatus } from './social-accounts.js';
import { STATUS_DISPLAY } from './status-display.js';
import { VARIANT_STATUSES } from './variant-state.js';
import { PUBLICATION_STATUSES } from './publication-state.js';

const DAY = 24 * 60 * 60 * 1000;

describe('piattaforme', () => {
  it('ha almeno un formato per ogni piattaforma', () => {
    for (const p of PLATFORMS) expect(PLATFORM_FORMATS[p].length).toBeGreaterThan(0);
  });

  it('usa il primo formato come default', () => {
    expect(defaultFormat('youtube')).toBe('video');
    expect(isFormatSupported('linkedin', 'storia')).toBe(false);
  });
});

describe('stato degli account', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  it('segnala da rinnovare entro 10 giorni dalla scadenza', () => {
    expect(deriveAccountStatus(new Date(now.getTime() + 9 * DAY), now, false)).toBe('da_rinnovare');
    expect(deriveAccountStatus(new Date(now.getTime() + 30 * DAY), now, false)).toBe('collegato');
  });

  it('considera scollegato un token scaduto e privilegia l’errore', () => {
    expect(deriveAccountStatus(new Date(now.getTime() - 1), now, false)).toBe('scollegato');
    expect(deriveAccountStatus(new Date(now.getTime() + 30 * DAY), now, true)).toBe('errore');
  });
});

describe('visualizzazione stati', () => {
  it('ha etichetta e token per ogni stato', () => {
    for (const s of [...VARIANT_STATUSES, ...PUBLICATION_STATUSES]) {
      expect(STATUS_DISPLAY[s].label).not.toBe('');
    }
  });
});
