import { afterAll, describe, expect, it } from 'vitest';
import type {
  AnalyticsInsights,
  AnalyticsReport,
  InsightsState,
  PublicationMetrics,
} from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { accountMetricSnapshots, publications } from '../src/db/schema.js';
import { createMetricsCollector } from '../src/modules/analytics/collector.js';
import { createAccessTokenResolver } from '../src/modules/social-accounts/tokens.js';
import {
  MetricsNotReadyError,
  createPublisherRegistry,
  type AccountDayMetrics,
  type PostMetrics,
} from '../src/publishers/types.js';
import { FakeLlm } from './helpers/fake-llm.js';
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

/** Nel 1990 come gli altri test con orologio: nessuna riga vera del database di sviluppo. */
const SERVICES_NOW = new Date('1990-01-01T12:00:00.000Z');
const PUBLISHED = new Date('1990-01-02T17:00:00.000Z');
const HOUR = 3_600_000;

class FakeMetricsPublisher extends FakePublisher {
  readonly asked: string[] = [];
  notReady = false;
  resolve = false;
  days: AccountDayMetrics[] = [];

  readonly metrics = {
    post: async (externalId: string, account: { accessToken: string }): Promise<PostMetrics> => {
      this.asked.push(`${externalId} ${account.accessToken}`);
      if (this.notReady) throw new MetricsNotReadyError('non ancora pubblico');
      return {
        capturedAt: new Date(),
        views: 1200,
        likes: 80,
        comments: 7,
        raw: {},
        resolved: this.resolve
          ? { externalId: '7311', externalUrl: 'https://tiktok.test/7311' }
          : undefined,
      };
    },
    account: async (): Promise<AccountDayMetrics[]> => this.days,
  };
}

async function published(ctx: TestContext, platform: 'tiktok' | 'linkedin' = 'tiktok') {
  const { publication } = await scheduledPublication(ctx, {
    platform,
    scheduledAt: PUBLISHED.toISOString(),
  });
  await ctx.tx
    .update(publications)
    .set({ status: 'pubblicato', externalId: 'v_inbox_file~1', publishedAt: PUBLISHED })
    .where(eq(publications.id, publication.id));
  return publication;
}

describe.skipIf(!databaseUrl)('metriche (MySQL)', () => {
  afterAll(closeDatabase);

  it('raccoglie i post dovuti, aggiorna l’id del post vero e non ripete prima del tempo', async () => {
    const publisher = new FakeMetricsPublisher('tiktok');
    await withRollback(
      async (ctx) => {
        const publication = await published(ctx);
        const clock = { now: new Date(PUBLISHED.getTime() + 2 * HOUR) };
        const collector = createMetricsCollector({
          db: ctx.tx,
          publishers: createPublisherRegistry([publisher]),
          accessToken: createAccessTokenResolver(TEST_CIPHER),
          now: () => clock.now,
        });

        publisher.notReady = true;
        expect(await collector.runOnce()).toMatchObject({ posts: 0, notReady: 1, failed: 0 });

        publisher.notReady = false;
        publisher.resolve = true;
        expect((await collector.runOnce()).posts).toBe(1);
        expect(publisher.asked.at(-1)).toBe(`v_inbox_file~1 ${TEST_ACCESS_TOKEN}`);
        const [row] = await ctx.tx
          .select()
          .from(publications)
          .where(eq(publications.id, publication.id));
        expect(row).toMatchObject({ externalId: '7311', externalUrl: 'https://tiktok.test/7311' });

        const latest = (
          await ctx.call({ method: 'GET', url: `/publications/${publication.id}/metrics` })
        ).json<{ metrics: PublicationMetrics }>().metrics;
        expect(latest).toMatchObject({
          views: 1200,
          likes: 80,
          comments: 7,
          reach: null,
          source: 'api',
        });

        // Il giorno dopo non è ancora passato un giorno pieno: nessuna nuova lettura.
        clock.now = new Date(clock.now.getTime() + 10 * HOUR);
        expect((await collector.runOnce()).posts).toBe(0);
        clock.now = new Date(clock.now.getTime() + 14 * HOUR);
        expect((await collector.runOnce()).posts).toBe(1);
        expect(publisher.asked.at(-1)).toMatch(/^7311 /);
      },
      { now: SERVICES_NOW },
    );
  });

  it('salva i giorni dell’account senza cancellare i valori che una nuova lettura non porta', async () => {
    const publisher = new FakeMetricsPublisher('tiktok');
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const accountId = await ctx.createAccount(brandId, 'tiktok');
        const clock = { now: new Date('1990-01-10T12:00:00.000Z') };
        const collector = createMetricsCollector({
          db: ctx.tx,
          publishers: createPublisherRegistry([publisher]),
          accessToken: createAccessTokenResolver(TEST_CIPHER),
          now: () => clock.now,
        });
        publisher.days = [
          { day: '1990-01-09', reach: 300, followersGained: 4 },
          { day: '1990-01-10', followers: 1200 },
        ];
        expect((await collector.runOnce()).accounts).toBe(1);
        expect((await collector.runOnce()).accounts).toBe(0);

        clock.now = new Date('1990-01-11T12:00:00.000Z');
        publisher.days = [{ day: '1990-01-09', reach: 320 }];
        expect((await collector.runOnce()).accounts).toBe(1);
        const rows = await ctx.tx
          .select()
          .from(accountMetricSnapshots)
          .where(eq(accountMetricSnapshots.socialAccountId, accountId))
          .orderBy(accountMetricSnapshots.day);
        expect(rows.map((r) => [r.day, r.reach, r.followersGained, r.followers])).toEqual([
          ['1990-01-09', 320, 4, null],
          ['1990-01-10', null, null, 1200],
        ]);
      },
      { now: SERVICES_NOW },
    );
  });

  it('LinkedIn: metriche inserite a mano solo per i post pubblicati', async () => {
    await withRollback(
      async (ctx) => {
        const publication = await published(ctx, 'linkedin');
        const saved = await ctx.call({
          method: 'POST',
          url: `/publications/${publication.id}/metrics`,
          payload: { impressions: 4700, likes: 120, comments: 18, shares: 6 },
        });
        expect(saved.statusCode).toBe(201);
        expect(saved.json<PublicationMetrics>()).toMatchObject({
          impressions: 4700,
          likes: 120,
          reach: null,
          source: 'manuale',
        });
        const empty = await ctx.call({
          method: 'POST',
          url: `/publications/${publication.id}/metrics`,
          payload: {},
        });
        expect(empty.statusCode).toBe(400);

        const { publication: queued } = await scheduledPublication(ctx, {
          platform: 'linkedin',
          scheduledAt: '1990-01-05T10:00:00.000Z',
        });
        const refused = await ctx.call({
          method: 'POST',
          url: `/publications/${queued.id}/metrics`,
          payload: { likes: 1 },
        });
        expect(refused.statusCode).toBe(422);
      },
      { now: SERVICES_NOW },
    );
  });

  it('report: serie per settimana, contenuti migliori e post LinkedIn da completare', async () => {
    const publisher = new FakeMetricsPublisher('tiktok');
    await withRollback(
      async (ctx) => {
        const tiktok = await published(ctx, 'tiktok');
        const collector = createMetricsCollector({
          db: ctx.tx,
          publishers: createPublisherRegistry([publisher]),
          accessToken: createAccessTokenResolver(TEST_CIPHER),
          now: () => new Date(PUBLISHED.getTime() + 2 * HOUR),
        });
        await collector.runOnce();
        const linkedin = await published(ctx, 'linkedin');
        await ctx.call({
          method: 'POST',
          url: `/publications/${linkedin.id}/metrics`,
          payload: { impressions: 4700, likes: 120 },
        });
        const brandId = (
          await ctx.call({ method: 'GET', url: `/publications/${tiktok.id}` })
        ).json<{ contentId: number }>().contentId;
        const content = (await ctx.call({ method: 'GET', url: `/contents/${brandId}` })).json<{
          brandId: number;
        }>();
        const res = await ctx.call({
          method: 'GET',
          url: `/brands/${content.brandId}/analytics?period=8w`,
        });
        expect(res.statusCode).toBe(200);
        const report = res.json<AnalyticsReport>();
        expect(report.buckets).toHaveLength(8);
        const tt = report.platforms.find((p) => p.platform === 'tiktok')!;
        expect(tt.series.reach.at(-1)).toBe(1200);
        expect(tt.series.interactions.at(-1)).toBe(87);
        expect(report.top.map((t) => [t.platform, t.reach, t.reachKind])).toEqual([
          ['tiktok', 1200, 'visualizzazioni'],
        ]);
        expect(
          (await ctx.call({ method: 'GET', url: `/brands/${content.brandId}/analytics?period=1y` }))
            .statusCode,
        ).toBe(400);
      },
      { now: SERVICES_NOW },
    );
  });

  it('suggerimenti dell’AI: bloccati con pochi dati, poi generati una volta a settimana', async () => {
    const publisher = new FakeMetricsPublisher('tiktok');
    const llm = new FakeLlm();
    const clock = { now: new Date(PUBLISHED.getTime() + 2 * HOUR) };
    await withRollback(
      async (ctx) => {
        const first = await published(ctx, 'tiktok');
        const content = (await ctx.call({ method: 'GET', url: `/publications/${first.id}` })).json<{
          contentId: number;
        }>();
        const { brandId } = (
          await ctx.call({ method: 'GET', url: `/contents/${content.contentId}` })
        ).json<{ brandId: number }>();
        const state = await ctx.call({
          method: 'GET',
          url: `/brands/${brandId}/analytics/insights`,
        });
        expect(state.json<InsightsState>()).toMatchObject({
          insights: null,
          blocked: expect.stringMatching(/almeno 3/),
        });

        // Altri due post dello stesso brand: stesso account, contenuti nuovi.
        const [account] = await ctx.tx
          .select({ id: publications.socialAccountId })
          .from(publications)
          .where(eq(publications.id, first.id));
        for (const title of ['Indici composti', 'Avalonia in pratica']) {
          const c = (
            await ctx.call({
              method: 'POST',
              url: `/brands/${brandId}/contents`,
              payload: { title, platforms: ['tiktok'] },
            })
          ).json<{ variants: Array<{ id: number }> }>();
          await ctx.tx.insert(publications).values({
            variantId: c.variants[0]!.id,
            socialAccountId: account!.id,
            scheduledAt: PUBLISHED,
            status: 'pubblicato',
            publishedAt: PUBLISHED,
            externalId: `v_${title}`,
            idempotencyKey: title.padEnd(64, 'x').slice(0, 64),
          });
        }
        const collector = createMetricsCollector({
          db: ctx.tx,
          publishers: createPublisherRegistry([publisher]),
          accessToken: createAccessTokenResolver(TEST_CIPHER),
          now: () => clock.now,
        });
        expect((await collector.runOnce()).posts).toBe(3);

        llm.responses.push({
          tips: [
            {
              kind: 'argomenti',
              text: 'I video su database vanno meglio.',
              why: 'Su 3 video TikTok',
              idea: 'Indici: errori comuni',
            },
            {
              kind: 'orari',
              text: 'TikTok: martedì alle 18.',
              why: 'Slot predefiniti',
              idea: 'non serve',
            },
            { kind: 'formati', text: 'Video sotto i 45 secondi.', why: 'Su 3 video', idea: null },
          ],
        });
        const created = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/analytics/insights`,
        });
        expect(created.statusCode).toBe(201);
        expect(created.json<AnalyticsInsights>()).toMatchObject({
          weekStart: '1990-01-01',
          basedOn: 3,
          model: 'fake',
          tips: [
            { kind: 'argomenti', idea: 'Indici: errori comuni' },
            { kind: 'orari', idea: null },
            { kind: 'formati' },
          ],
        });
        expect(llm.lastPrompt()).toContain('"Indici composti"');
        expect(llm.lastPrompt()).toContain('Slot consigliati attuali');

        const after = (
          await ctx.call({ method: 'GET', url: `/brands/${brandId}/analytics/insights` })
        ).json<InsightsState>();
        expect(after).toMatchObject({ blocked: null, insights: { basedOn: 3 } });
      },
      { now: SERVICES_NOW, llm },
    );
  });
});
