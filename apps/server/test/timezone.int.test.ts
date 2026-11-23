import { afterAll, describe, expect, it } from 'vitest';
import type { Brand } from '@prisma-app/shared';
import { closeDatabase, databaseUrl, withRollback } from './helpers/integration.js';

describe.skipIf(!databaseUrl)('fuso orario del database', () => {
  afterAll(closeDatabase);

  it('salva in UTC anche le date generate da MySQL', () =>
    withRollback(async ({ call }) => {
      const res = await call({
        method: 'POST',
        url: '/brands',
        payload: { name: 'Fuso', initials: 'FU' },
      });
      const createdAt = new Date(res.json<Brand>().createdAt).getTime();
      expect(Math.abs(createdAt - Date.now())).toBeLessThan(5 * 60 * 1000);
    }));
});
