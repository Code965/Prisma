import { DEFAULT_BRAND, type Brand, type Tag } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { initialsFrom, normalizeTag, shouldShowSetup, tagChanges } from './setup';

const brand = (name: string): Brand =>
  ({ id: 1, name, initials: 'XX', timezone: 'Europe/Rome' }) as Brand;
const tag = (id: number, name: string): Tag => ({ id, name }) as Tag;

describe('configurazione guidata', () => {
  it('si apre solo su un database nuovo e non completato', () => {
    expect(shouldShowSetup([brand(DEFAULT_BRAND.name)], false)).toBe(true);
    expect(shouldShowSetup([brand(DEFAULT_BRAND.name)], true)).toBe(false);
    expect(shouldShowSetup([brand('Marta Rossi')], false)).toBe(false);
    expect(shouldShowSetup(undefined, false)).toBe(false);
  });

  it('ricava le iniziali dal nome', () => {
    expect(initialsFrom('Marta Rossi')).toBe('MR');
    expect(initialsFrom('  dev.tips  ')).toBe('DE');
    expect(initialsFrom('Àlex  Ünal Terzo')).toBe('ÀÜ');
    expect(initialsFrom('   ')).toBe('');
  });

  it('normalizza gli argomenti e calcola cosa aggiungere e togliere', () => {
    expect(normalizeTag('  AI   locale ')).toBe('AI locale');
    const existing = [tag(1, 'Tutorial'), tag(2, 'Novità')];
    expect(tagChanges(existing, ['tutorial', 'GIS'])).toEqual({
      add: ['GIS'],
      remove: [existing[1]],
    });
  });
});
