import { afterAll, describe, expect, it } from 'vitest';
import type { PublicationAttempt, PublicationView, Variant } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { createTokenCipher } from '../src/crypto/token-cipher.js';
import { publications, socialAccounts } from '../src/db/schema.js';
import { applyPublicationTransition } from '../src/modules/publications/transitions.js';
import { createPublisherRegistry } from '../src/publishers/types.js';
import { STALE_MESSAGE, createScheduler } from '../src/scheduler/worker.js';
import { FakePublisher } from './helpers/fake-publisher.js';
import { scheduledPublication } from './helpers/flows.js';
import {
  TEST_ACCESS_TOKEN,
  TEST_CIPHER,
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

/**
 * Tutto avviene nel 1990: lo scheduler vede solo le righe create da questi test (dentro la
 * transazione annullata), mai pubblicazioni vere del database di sviluppo, che sono nel futuro.
 */
const SERVICES_NOW = new Date('1990-01-01T12:00:00.000Z');
const SLOT = '1990-01-02T17:00:00.000Z';
const MINUTE = 60_000;
const DUE = new Date(new Date(SLOT).getTime() + MINUTE);

const inThePast = (test: (ctx: TestContext) => Promise<void>) =>
  withRollback(test, { now: SERVICES_NOW });
const schedule = (ctx: TestContext) => scheduledPublication(ctx, { scheduledAt: SLOT });

function setup(ctx: TestContext, publisher = new FakePublisher()) {
  const clock = { now: DUE };
  const scheduler = createScheduler({
    db: ctx.tx,
    publishers: createPublisherRegistry([publisher]),
    cipher: TEST_CIPHER,
    now: () => clock.now,
    random: () => 0.5, // jitter nullo: backoff prevedibile
  });
  const read = async (publicationId: number) => {
    const publication = (
      await ctx.call({ method: 'GET', url: `/publications/${publicationId}` })
    ).json<PublicationView>();
    const variant = (
      await ctx.call({ method: 'GET', url: `/variants/${publication.variantId}` })
    ).json<Variant>();
    const attempts = (
      await ctx.call({ method: 'GET', url: `/publications/${publicationId}/attempts` })
    ).json<PublicationAttempt[]>();
    return { publication, variant, attempts };
  };
  return { clock, scheduler, publisher, read };
}

describe.skipIf(!databaseUrl)('scheduler di pubblicazione (MySQL)', () => {
  afterAll(closeDatabase);

  it('passa all’adapter i file della variant, in validate e in publish', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      const media = [
        {
          assetId: 1,
          kind: 'pdf' as const,
          role: 'media' as const,
          position: 0,
          mime: 'application/pdf',
          sizeBytes: 10,
          width: 1080,
          height: 1350,
          durationMs: null,
          checksumSha256: 'a'.repeat(64),
          localPath: null,
          remoteKey: 'brand-1/a.pdf',
          remoteUrl: null,
          upToDate: true,
        },
      ];
      const requested: number[] = [];
      const publisher = new FakePublisher();
      const scheduler = createScheduler({
        db: ctx.tx,
        publishers: createPublisherRegistry([publisher]),
        cipher: TEST_CIPHER,
        now: () => DUE,
        loadMedia: async (variantId) => {
          requested.push(variantId);
          return media;
        },
      });

      expect(await scheduler.runOnce()).toMatchObject({ published: 1 });
      expect(requested).toEqual([publication.variantId]);
      expect(publisher.validatedMedia).toEqual(media);
      expect(publisher.calls[0]!.media).toEqual(media);
    }));

  it('pubblica una pubblicazione scaduta e allinea la variant', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      const { scheduler, publisher, read } = setup(ctx);

      expect(await scheduler.runOnce()).toMatchObject({ claimed: 1, published: 1 });

      const state = await read(publication.id);
      expect(state.publication).toMatchObject({
        status: 'pubblicato',
        externalId: `post-${publication.id}`,
        attempts: 1,
        publishedAt: DUE.toISOString(),
      });
      expect(state.variant.status).toBe('pubblicato');
      expect(state.attempts).toMatchObject([{ attemptNo: 1, outcome: 'successo' }]);

      expect(publisher.calls).toHaveLength(1);
      expect(publisher.calls[0]!.account.accessToken).toBe(TEST_ACCESS_TOKEN);
      expect(publisher.calls[0]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    }));

  it('non tocca ciò che non è ancora scaduto né le piattaforme senza adapter', () =>
    inThePast(async (ctx) => {
      await schedule(ctx);
      const early = setup(ctx);
      early.clock.now = new Date(new Date(SLOT).getTime() - MINUTE);
      expect((await early.scheduler.runOnce()).claimed).toBe(0);

      const otherPlatform = setup(ctx, new FakePublisher('youtube'));
      expect((await otherPlatform.scheduler.runOnce()).claimed).toBe(0);
    }));

  it('ritenta gli errori temporanei con backoff e poi pubblica', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      const { clock, scheduler, publisher, read } = setup(ctx);
      publisher.behaviours.push('transient');

      expect(await scheduler.runOnce()).toMatchObject({ retried: 1 });
      let state = await read(publication.id);
      expect(state.publication).toMatchObject({
        status: 'programmato',
        attempts: 1,
        lastError: 'Rate limit, riprova più tardi',
        nextAttemptAt: new Date(DUE.getTime() + MINUTE).toISOString(),
      });
      expect(state.variant.status).toBe('programmato');

      // Prima della nuova scadenza non riparte.
      expect((await scheduler.runOnce()).claimed).toBe(0);

      clock.now = new Date(DUE.getTime() + MINUTE);
      expect(await scheduler.runOnce()).toMatchObject({ published: 1 });
      state = await read(publication.id);
      expect(state.publication).toMatchObject({
        status: 'pubblicato',
        attempts: 2,
        lastError: null,
      });
      expect(state.attempts.map((a) => a.outcome)).toEqual(['successo', 'errore_temporaneo']);
    }));

  it('va in errore quando i tentativi sono finiti', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      await ctx.tx
        .update(publications)
        .set({ maxAttempts: 2 })
        .where(eq(publications.id, publication.id));
      const { clock, scheduler, publisher, read } = setup(ctx);
      publisher.behaviours.push('crash', 'crash');

      expect(await scheduler.runOnce()).toMatchObject({ retried: 1 });
      clock.now = new Date(DUE.getTime() + 10 * MINUTE);
      expect(await scheduler.runOnce()).toMatchObject({ failed: 1 });

      const state = await read(publication.id);
      expect(state.publication).toMatchObject({
        status: 'errore',
        attempts: 2,
        lastError: 'ECONNRESET',
      });
      expect(state.variant.status).toBe('errore');
    }));

  it('non ritenta gli errori definitivi né le variant che non passano la validazione', () =>
    inThePast(async (ctx) => {
      const first = await schedule(ctx);
      const { scheduler, publisher, read } = setup(ctx);
      publisher.behaviours.push('permanent');
      expect(await scheduler.runOnce()).toMatchObject({ failed: 1 });
      expect((await read(first.publication.id)).publication.lastError).toBe('Contenuto rifiutato');

      const second = await schedule(ctx);
      publisher.issues = [{ level: 'error', message: 'Testo oltre 3.000 caratteri' }];
      expect(await scheduler.runOnce()).toMatchObject({ failed: 1 });
      expect((await read(second.publication.id)).publication.lastError).toBe(
        'Testo oltre 3.000 caratteri',
      );
      expect(publisher.calls).toHaveLength(1);
    }));

  it('non ripubblica un post che risulta già pubblicato', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      // Simula un tentativo precedente arrivato alla piattaforma.
      await ctx.tx
        .update(publications)
        .set({ externalId: 'gia-online', externalUrl: 'https://example.test/gia-online' })
        .where(eq(publications.id, publication.id));
      const { scheduler, publisher, read } = setup(ctx);

      expect(await scheduler.runOnce()).toMatchObject({ published: 1 });
      expect(publisher.calls).toHaveLength(0);
      expect((await read(publication.id)).publication.externalId).toBe('gia-online');
    }));

  it('chiude come errore un invio rimasto a metà senza ripubblicarlo', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      await applyPublicationTransition(ctx.tx, publication.id, 'start', {
        now: DUE,
        values: { attempts: 1, lockedBy: 'worker-morto', lockedAt: DUE },
      });
      const { clock, scheduler, publisher, read } = setup(ctx);
      clock.now = new Date(DUE.getTime() + 31 * MINUTE);

      expect(await scheduler.runOnce()).toMatchObject({ recovered: 1, claimed: 0 });
      const state = await read(publication.id);
      expect(state.publication).toMatchObject({ status: 'errore', lastError: STALE_MESSAGE });
      expect(state.variant.status).toBe('errore');
      expect(publisher.calls).toHaveLength(0);
    }));

  it('fallisce senza ritentare se il token non si decifra', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      const publisher = new FakePublisher();
      const scheduler = createScheduler({
        db: ctx.tx,
        publishers: createPublisherRegistry([publisher]),
        cipher: createTokenCipher(Buffer.alloc(32, 7).toString('base64')),
        now: () => DUE,
      });
      expect(await scheduler.runOnce()).toMatchObject({ failed: 1 });
      expect(publisher.calls).toHaveLength(0);
      const res = await ctx.call({ method: 'GET', url: `/publications/${publication.id}` });
      expect(res.json<PublicationView>().lastError).toMatch(/ricollega/);
    }));

  it('salva gli avvisi su una pubblicazione riuscita', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      const { scheduler, publisher, read } = setup(ctx);
      publisher.warnings = ['primo commento non aggiunto'];
      expect(await scheduler.runOnce()).toMatchObject({ published: 1 });
      expect((await read(publication.id)).publication).toMatchObject({
        status: 'pubblicato',
        lastError: 'Avviso: primo commento non aggiunto',
      });
    }));

  it('non invia con un token scaduto', () =>
    inThePast(async (ctx) => {
      const { publication } = await schedule(ctx);
      await ctx.tx
        .update(socialAccounts)
        .set({ tokenExpiresAt: new Date(DUE.getTime() - MINUTE) })
        .where(eq(socialAccounts.id, publication.socialAccountId));
      const { scheduler, publisher, read } = setup(ctx);
      expect(await scheduler.runOnce()).toMatchObject({ failed: 1 });
      expect(publisher.calls).toHaveLength(0);
      expect((await read(publication.id)).publication.lastError).toMatch(/scaduto/);
    }));
});
