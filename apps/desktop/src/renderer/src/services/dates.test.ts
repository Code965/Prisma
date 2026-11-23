import { describe, expect, it } from 'vitest';
import { relativeDay } from './dates';

const now = new Date('2026-11-21T12:00:00Z'); // sabato 21, ore 13 in Italia

describe('date relative in ora italiana', () => {
  it('distingue oggi, ieri e giorni', () => {
    expect(relativeDay('2026-11-21T06:00:00Z', now)).toBe('oggi');
    expect(relativeDay('2026-11-20T10:00:00Z', now)).toBe('ieri');
    expect(relativeDay('2026-11-17T10:00:00Z', now)).toBe('4 giorni fa');
  });

  it('conta i giorni di calendario italiani, non le 24 ore', () => {
    // 23:30 UTC del 20 = 00:30 del 21 in Italia: è "oggi", anche se sono passate quasi 13 ore.
    expect(relativeDay('2026-11-20T23:30:00Z', now)).toBe('oggi');
    // 22:30 UTC del 20 = 23:30 del 20 in Italia: è "ieri".
    expect(relativeDay('2026-11-20T22:30:00Z', now)).toBe('ieri');
  });

  it('passa a settimane e poi alla data', () => {
    expect(relativeDay('2026-11-14T10:00:00Z', now)).toBe('1 settimana fa');
    expect(relativeDay('2026-11-04T10:00:00Z', now)).toBe('2 settimane fa');
    expect(relativeDay('2026-10-12T10:00:00Z', now)).toBe('12 ott');
  });
});
