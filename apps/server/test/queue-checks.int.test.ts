import { afterAll, describe, expect, it } from 'vitest';
import type { PublicationChecks } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { socialAccounts } from '../src/db/schema.js';
import { createLinkedInAdapter } from '../src/publishers/linkedin/adapter.js';
import { createLinkedInClient } from '../src/publishers/linkedin/client.js';
import { createPublisherRegistry } from '../src/publishers/types.js';
import { FakeLinkedIn } from './helpers/fake-linkedin.js';
import { scheduledPublication } from './helpers/flows.js';
import { closeDatabase, databaseUrl, withRollback } from './helpers/integration.js';

const publishers = createPublisherRegistry([
  createLinkedInAdapter(
    createLinkedInClient({ apiVersion: '202611', fetch: new FakeLinkedIn().fetch }),
  ),
]);

describe.skipIf(!databaseUrl)('controlli dei requisiti in coda (MySQL)', () => {
  afterAll(closeDatabase);

  it('usa validate() dell’adapter e verifica l’account', () =>
    withRollback(
      async (ctx) => {
        const { publication, brandId } = await scheduledPublication(ctx);
        const res = await ctx.call({
          method: 'GET',
          url: `/publications/checks?brandId=${brandId}`,
        });
        expect(res.statusCode).toBe(200);
        const [entry] = res.json<PublicationChecks[]>();
        expect(entry!.publicationId).toBe(publication.id);
        expect(entry!.checks).toEqual([
          { level: 'ok', message: 'Post di testo' },
          { level: 'ok', message: 'Testo 15 / 3.000' },
          { level: 'ok', message: 'Account Account linkedin' },
        ]);
      },
      { publishers },
    ));

  it('avvisa quando la piattaforma non ha ancora un adapter', () =>
    withRollback(
      async (ctx) => {
        const { brandId } = await scheduledPublication(ctx, { platform: 'youtube' });
        const res = await ctx.call({
          method: 'GET',
          url: `/publications/checks?brandId=${brandId}`,
        });
        const [entry] = res.json<PublicationChecks[]>();
        expect(entry!.checks[0]).toMatchObject({ level: 'warning' });
        expect(entry!.checks[0]!.message).toMatch(/YouTube non ancora disponibile/);
      },
      { publishers },
    ));

  it('blocca se il token scade prima dell’uscita', () =>
    withRollback(
      async (ctx) => {
        const { publication, brandId } = await scheduledPublication(ctx);
        await ctx.tx
          .update(socialAccounts)
          .set({ tokenExpiresAt: new Date(new Date(publication.scheduledAt).getTime() - 60_000) })
          .where(eq(socialAccounts.id, publication.socialAccountId));
        const res = await ctx.call({
          method: 'GET',
          url: `/publications/checks?brandId=${brandId}`,
        });
        const [entry] = res.json<PublicationChecks[]>();
        expect(entry!.checks.at(-1)).toMatchObject({ level: 'error' });
        expect(entry!.checks.at(-1)!.message).toMatch(/scade prima dell'uscita/);
      },
      { publishers },
    ));
});
