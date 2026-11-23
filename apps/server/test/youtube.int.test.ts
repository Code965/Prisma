import { afterAll, describe, expect, it } from 'vitest';
import type { PublicationView, SocialAccount } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { publications, socialAccounts } from '../src/db/schema.js';
import { deriveStateSecret } from '../src/modules/oauth/config.js';
import {
  youtubeTokenRefresher,
  type YouTubeOAuthConfig,
} from '../src/modules/oauth/youtube-service.js';
import { createAccessTokenResolver } from '../src/modules/social-accounts/tokens.js';
import { PublishError, createPublisherRegistry } from '../src/publishers/types.js';
import { createYouTubeClient } from '../src/publishers/youtube/client.js';
import { createScheduler } from '../src/scheduler/worker.js';
import { FakeAdvancePublisher } from './helpers/fake-publisher.js';
import { FakeYouTube } from './helpers/fake-youtube.js';
import { scheduledPublication } from './helpers/flows.js';
import {
  TEST_ACCESS_TOKEN,
  TEST_CIPHER,
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

/** Nel 1990, come i test dello scheduler: le pubblicazioni vere del DB sono nel futuro. */
const SERVICES_NOW = new Date('1990-01-01T12:00:00.000Z');
const SLOT = '1990-01-02T17:00:00.000Z';
const MINUTE = 60_000;

function oauthConfig(youtube = new FakeYouTube()): YouTubeOAuthConfig {
  return {
    client: createYouTubeClient({ fetch: youtube.fetch, put: youtube.put }),
    clientId: 'client.apps.googleusercontent.com',
    clientSecret: 'segreto',
    redirectUri: 'http://localhost:4000/oauth/youtube/callback',
    cipher: TEST_CIPHER,
    stateSecret: deriveStateSecret(Buffer.alloc(32, 3).toString('base64')),
  };
}

describe.skipIf(!databaseUrl)('YouTube (MySQL, API simulate)', () => {
  afterAll(closeDatabase);

  it('collega il canale: refresh token cifrato, nessuna scadenza, nome del canale', async () => {
    const youtube = new FakeYouTube();
    const config = oauthConfig(youtube);
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const start = await ctx.call({
          method: 'GET',
          url: `/oauth/youtube/start?brandId=${brandId}`,
        });
        const url = new URL(start.json<{ url: string }>().url);
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        const state = url.searchParams.get('state')!;
        // App «Desktop» di Google: PKCE S256.
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        const callback = await ctx.callAnonymous({
          method: 'GET',
          url: `/oauth/youtube/callback?code=codice&state=${encodeURIComponent(state)}`,
        });
        expect(callback.statusCode).toBe(200);
        expect(callback.body).toContain('Marta Dev');

        const account = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/social-accounts` })
        ).json<SocialAccount[]>()[0]!;
        expect(account).toMatchObject({
          platform: 'youtube',
          displayName: 'Marta Dev',
          status: 'collegato',
        });
        const [row] = await ctx.tx
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.id, account.id));
        expect(row!.tokenExpiresAt).toBeNull();
        const context = tokenContext('youtube', 'UC123');
        expect(TEST_CIPHER.decrypt(row!.refreshTokenEnc!, context)).toBe('refresh-1');

        // Il token di accesso si chiede a ogni uso con il refresh token.
        const resolve = createAccessTokenResolver(TEST_CIPHER, {
          youtube: youtubeTokenRefresher(config),
        });
        await expect(resolve(row!)).resolves.toBe('accesso-rinnovato');
        youtube.refreshFails = true;
        await expect(resolve(row!)).rejects.toMatchObject({
          retryable: false,
          message: expect.stringContaining('ricollega'),
        });
      },
      { youtubeOAuth: config },
    );
  });

  async function setup(ctx: TestContext, publisher: FakeAdvancePublisher) {
    const { publication } = await scheduledPublication(ctx, {
      platform: 'youtube',
      scheduledAt: SLOT,
    });
    const clock = { now: SERVICES_NOW };
    const scheduler = createScheduler({
      db: ctx.tx,
      publishers: createPublisherRegistry([publisher]),
      cipher: TEST_CIPHER,
      now: () => clock.now,
      random: () => 0.5,
    });
    const read = async () => {
      const [row] = await ctx.tx
        .select()
        .from(publications)
        .where(eq(publications.id, publication.id));
      return row!;
    };
    return { publication, clock, scheduler, read };
  }

  const withAdvance = (
    publisher: FakeAdvancePublisher,
    test: (ctx: TestContext) => Promise<void>,
  ) =>
    withRollback(test, {
      now: SERVICES_NOW,
      publishers: createPublisherRegistry([publisher]),
      accessToken: createAccessTokenResolver(TEST_CIPHER),
    });

  it('carica in anticipo restando programmato, poi all’orario rende pubblico', async () => {
    const publisher = new FakeAdvancePublisher();
    await withAdvance(publisher, async (ctx) => {
      const { publication, clock, scheduler, read } = await setup(ctx, publisher);
      const first = await scheduler.runOnce();
      expect(first).toMatchObject({ prepared: 1, claimed: 0 });
      expect(publisher.log).toEqual([`prepare ${publication.id} ${SLOT}`]);
      expect(await read()).toMatchObject({
        status: 'programmato',
        externalId: `video-${publication.id}`,
        lockedBy: null,
        uploadSession: 'sessione-1',
      });
      // Già caricata: nessun secondo caricamento.
      expect((await scheduler.runOnce()).prepared).toBe(0);

      clock.now = new Date(new Date(SLOT).getTime() + MINUTE);
      expect(await scheduler.runOnce()).toMatchObject({ claimed: 1, published: 1 });
      expect(publisher.log.at(-1)).toBe(`finalize video-${publication.id} ${TEST_ACCESS_TOKEN}`);
      expect(publisher.calls).toHaveLength(0);
      expect(await read()).toMatchObject({
        status: 'pubblicato',
        externalUrl: `https://video.test/video-${publication.id}`,
      });
    });
  });

  it('troppo vicino all’orario non carica in anticipo; un errore si riprova dopo un’ora', async () => {
    const publisher = new FakeAdvancePublisher();
    await withAdvance(publisher, async (ctx) => {
      const { clock, scheduler, read } = await setup(ctx, publisher);
      clock.now = new Date(new Date(SLOT).getTime() - 10 * MINUTE);
      expect((await scheduler.runOnce()).prepared).toBe(0);
      expect(publisher.log).toEqual([]);

      clock.now = SERVICES_NOW;
      publisher.failNext = new PublishError('quota', false);
      expect((await scheduler.runOnce()).prepared).toBe(0);
      expect(await read()).toMatchObject({
        externalId: null,
        lockedBy: null,
        lastError: 'Caricamento anticipato non riuscito: quota',
      });
      clock.now = new Date(SERVICES_NOW.getTime() + 30 * MINUTE);
      await scheduler.runOnce();
      expect(publisher.log).toHaveLength(1);
      clock.now = new Date(SERVICES_NOW.getTime() + 61 * MINUTE);
      expect((await scheduler.runOnce()).prepared).toBe(1);
    });
  });

  it('Annulla cancella il video dalla piattaforma, Sposta cambia l’uscita', async () => {
    const publisher = new FakeAdvancePublisher();
    await withAdvance(publisher, async (ctx) => {
      const { publication, scheduler, read } = await setup(ctx, publisher);
      await scheduler.runOnce();
      const later = '1990-01-03T09:00:00.000Z';
      const moved = await ctx.call({
        method: 'PATCH',
        url: `/publications/${publication.id}`,
        payload: { scheduledAt: later },
      });
      expect(moved.statusCode).toBe(200);
      expect(publisher.log.at(-1)).toBe(`reschedule video-${publication.id} ${later}`);

      // Se la piattaforma non risponde, in Prisma non cambia nulla.
      publisher.failNext = new PublishError('YouTube non risponde', true);
      const refused = await ctx.call({
        method: 'POST',
        url: `/publications/${publication.id}/cancel`,
      });
      expect(refused.statusCode).toBe(422);
      expect((await read()).status).toBe('programmato');

      const cancelled = await ctx.call({
        method: 'POST',
        url: `/publications/${publication.id}/cancel`,
      });
      expect(cancelled.json<PublicationView>().status).toBe('annullato');
      expect(publisher.log.at(-1)).toBe(`withdraw video-${publication.id} ${TEST_ACCESS_TOKEN}`);
      expect(await read()).toMatchObject({ externalId: null, uploadSession: null });
    });
  });

  it('durante il caricamento anticipato Sposta e Annulla aspettano', async () => {
    const publisher = new FakeAdvancePublisher();
    await withAdvance(publisher, async (ctx) => {
      const { publication } = await setup(ctx, publisher);
      await ctx.tx
        .update(publications)
        .set({ lockedBy: 'worker-x', lockedAt: SERVICES_NOW })
        .where(eq(publications.id, publication.id));
      const moved = await ctx.call({
        method: 'PATCH',
        url: `/publications/${publication.id}`,
        payload: { scheduledAt: '1990-01-03T09:00:00.000Z' },
      });
      expect(moved.statusCode).toBe(422);
      expect(moved.json<{ message: string }>().message).toMatch(/in corso/);
      const now = await ctx.call({
        method: 'POST',
        url: `/publications/${publication.id}/publish-now`,
      });
      expect(now.statusCode).toBe(422);
    });
  });
});
