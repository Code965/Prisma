import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrations.js';
import {
  brands,
  contents,
  publicationAttempts,
  publications,
  socialAccounts,
  variants,
} from '../src/db/schema.js';
import { createPublisherRegistry } from '../src/publishers/types.js';
import { createScheduler } from '../src/scheduler/worker.js';
import { FakePublisher } from './helpers/fake-publisher.js';
import { TEST_CIPHER } from './helpers/integration.js';

/**
 * Tre worker sullo stesso database SQLite (in memoria) che girano insieme: le transazioni sono
 * una alla volta (db/client.ts), quindi nessuna pubblicazione viene presa da due worker.
 */
const CLOCK = new Date('2000-01-01T00:01:00.000Z');
const DUE_AT = new Date('2000-01-01T00:00:00.000Z');
const PUBLICATIONS = 8;
const WORKERS = 3;

async function seed(db: Database): Promise<number[]> {
  const [brand] = await db
    .insert(brands)
    .values({ name: 'Concorrenza', initials: 'TC' })
    .returning({ id: brands.id });
  const externalId = `concorrenza-${brand!.id}`;
  const [account] = await db
    .insert(socialAccounts)
    .values({
      brandId: brand!.id,
      platform: 'tiktok',
      externalId,
      displayName: 'Account di test',
      accessTokenEnc: TEST_CIPHER.encrypt('token', tokenContext('tiktok', externalId)),
    })
    .returning({ id: socialAccounts.id });
  const [content] = await db
    .insert(contents)
    .values({ brandId: brand!.id, title: 'Concorrenza' })
    .returning({ id: contents.id });

  const ids: number[] = [];
  for (let i = 0; i < PUBLICATIONS; i++) {
    // Una variant per pubblicazione; il vincolo (contenuto, piattaforma) impone contenuti distinti.
    const [ownContent] =
      i === 0
        ? [content]
        : await db
            .insert(contents)
            .values({ brandId: brand!.id, title: `Concorrenza ${i}` })
            .returning({ id: contents.id });
    const [variant] = await db
      .insert(variants)
      .values({
        contentId: ownContent!.id,
        platform: 'tiktok',
        format: 'video',
        body: `Post ${i}`,
        metadata: { hashtags: [] },
        status: 'programmato',
      })
      .returning({ id: variants.id });
    const [publication] = await db
      .insert(publications)
      .values({
        variantId: variant!.id,
        socialAccountId: account!.id,
        scheduledAt: DUE_AT,
        nextAttemptAt: DUE_AT,
        idempotencyKey: `concorrenza-${variant!.id}`,
      })
      .returning({ id: publications.id });
    ids.push(publication!.id);
  }
  return ids;
}

describe('scheduler con più worker in parallelo', () => {
  const database = createDatabase(':memory:');
  applyMigrations(database.sqlite);
  const admin = database.db;

  afterAll(() => database.close());

  it('pubblica ogni post una sola volta anche con worker concorrenti', async () => {
    const ids = await seed(admin);
    const publisher = new FakePublisher('tiktok');
    publisher.delayMs = 30; // allarga la finestra in cui i worker si sovrappongono

    const workers = Array.from({ length: WORKERS }, (_, index) =>
      createScheduler({
        db: admin,
        publishers: createPublisherRegistry([publisher]),
        cipher: TEST_CIPHER,
        now: () => CLOCK,
        workerId: `test-${index}`,
        batchSize: 2,
      }),
    );

    // Tutti i worker girano insieme finché nessuno trova più lavoro.
    const claimedByWorker = workers.map(() => 0);
    let claimedInRound = Infinity;
    for (let round = 0; claimedInRound > 0 && round < 20; round++) {
      const summaries = await Promise.all(workers.map((worker) => worker.runOnce()));
      summaries.forEach((s, index) => (claimedByWorker[index]! += s.claimed));
      claimedInRound = summaries.reduce((sum, s) => sum + s.claimed, 0);
    }
    // Il lavoro si è davvero distribuito: altrimenti il test non proverebbe nulla.
    expect(claimedByWorker.filter((n) => n > 0).length).toBeGreaterThan(1);

    const calledIds = publisher.calls.map((call) => call.publicationId).sort((a, b) => a - b);
    expect(calledIds).toEqual([...ids].sort((a, b) => a - b));

    const rows = await admin
      .select({ status: publications.status, attempts: publications.attempts })
      .from(publications)
      .where(inArray(publications.id, ids));
    expect(rows.every((row) => row.status === 'pubblicato' && row.attempts === 1)).toBe(true);

    const attempts = await admin
      .select({ id: publicationAttempts.id })
      .from(publicationAttempts)
      .where(inArray(publicationAttempts.publicationId, ids));
    expect(attempts).toHaveLength(PUBLICATIONS);
  });
});
