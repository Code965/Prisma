import type { Brand, SocialAccount } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { accountRows } from './accounts';
import { pickBrand } from './brands';

const now = new Date('2026-11-21T12:00:00Z');

function account(overrides: Partial<SocialAccount>): SocialAccount {
  return {
    id: 1,
    brandId: 1,
    platform: 'linkedin',
    handle: null,
    displayName: 'Profilo',
    status: 'collegato',
    tokenExpiresAt: '2027-01-15T12:00:00.000Z',
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe('righe degli account', () => {
  it('propone di collegare tutti i social e di configurare il blog', () => {
    const rows = accountRows([], now);
    expect(rows.map((r) => [r.platform, r.action])).toEqual([
      ['linkedin', 'collega'],
      ['instagram', 'collega'],
      ['tiktok', 'collega'],
      ['youtube', 'collega'],
      ['blog', 'configura'],
    ]);
  });

  it('mostra stato e scadenza del token', () => {
    const [linkedin] = accountRows([account({})], now);
    expect(linkedin).toMatchObject({ statusLabel: 'Collegato', action: null });
    expect(linkedin!.note).toBe('Token valido ancora 55 giorni');
  });

  it('propone di ricollegare un account da rinnovare', () => {
    const [linkedin] = accountRows(
      [account({ status: 'da_rinnovare', tokenExpiresAt: '2026-11-22T12:00:00.000Z' })],
      now,
    );
    expect(linkedin).toMatchObject({ statusLabel: 'Da rinnovare', action: 'ricollega' });
    expect(linkedin!.note).toBe('Token valido ancora 1 giorno');
  });
});

describe('brand attivo', () => {
  const brands = [{ id: 1 }, { id: 2 }] as Brand[];

  it('usa quello scelto se esiste, altrimenti il primo', () => {
    expect(pickBrand(brands, 2)?.id).toBe(2);
    expect(pickBrand(brands, 99)?.id).toBe(1);
    expect(pickBrand(brands, null)?.id).toBe(1);
    expect(pickBrand([], 1)).toBeNull();
  });

  it('per il blog propone il modulo e preferisce l’account attivo a quello sostituito', () => {
    const rows = accountRows(
      [
        account({
          id: 1,
          platform: 'blog',
          displayName: 'vecchio.test',
          status: 'scollegato',
          tokenExpiresAt: null,
        }),
        account({ id: 2, platform: 'blog', displayName: 'nuovo.test', tokenExpiresAt: null }),
      ],
      now,
    );
    const blog = rows.find((r) => r.platform === 'blog')!;
    expect(blog).toMatchObject({ action: 'configura', statusLabel: 'Collegato' });
    expect(blog.account?.displayName).toBe('nuovo.test');
  });

  it('per Instagram ricorda che il token si rinnova da solo', () => {
    const [, instagram] = accountRows([account({ platform: 'instagram' })], now);
    expect(instagram!.note).toBe('Token valido ancora 55 giorni · rinnovo automatico');
  });
});
