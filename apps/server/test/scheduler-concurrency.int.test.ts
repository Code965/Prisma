import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { createDatabase, type Database } from '../src/db/client.js';
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
import { TEST_CIPHER, databaseUrl } from './helpers/integration.js';

/**
 * Questo test ha bisogno di dati salvati davvero: ogni worker usa una sua connessione e
 * `SKIP LOCKED` agisce tra transazioni diverse. Per non toccare i dati di sviluppo:
 * - l'orologio dei worker è fermo al 2000, e solo le righe create qui scadono prima di allora;
 * - si usa TikTok, che non ha ancora un adapter: lo scheduler del server di sviluppo le ignora;
 * - il brand ha un nome riconoscibile e tutto viene cancellato alla fine (e all'inizio,
 *   se un'esecuzione precedente si è interrotta).
 */
const MARKER = '__test_scheduler_concorrenza__';
const CLOCK = new Date('2000-01-01T00:01:00.000Z');
const DUE_AT = new Date('2000-01-01T00:00:00.000Z');
const PUBLICATIONS = 8;
const WORKERS = 3;

async function cleanup(db: Database): Promise<void> {
  const testBrands = await db.select({ id: brands.id }).from(brands).where(eq(brands.name, MARKER));
  const brandIds = testBrands.map((b) => b.id);
  if (brandIds.length === 0) return;
  const contentRows = await db
    .select({ id: contents.id })
    .from(contents)
    .where(inArray(contents.brandId, brandIds));
  const contentIds = contentRows.map((c) => c.id);
  if (contentIds.length > 0) {
    const variantRows = await db
      .select({ id: variants.id })
      .from(variants)
      .where(inArray(variants.contentId, contentIds));
    const variantIds = variantRows.map((v) => v.id);
    if (variantIds.length > 0) {
      await db.delete(publications).where(inArray(publications.variantId, variantIds));
    }
    await db.delete(contents).where(inArray(contents.id, contentIds));
  }
  await db.delete(socialAccounts).where(inArray(socialAccounts.brandId, brandIds));
  await db.delete(brands).where(inArray(brands.id, brandIds));
}

async function seed(db: Database): Promise<number[]> {
  const [brand] = await db.insert(brands).values({ name: MARKER, initials: 'TC' }).$returningId();
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
    .$returningId();
  const [content] = await db
    .insert(contents)
    .values({ brandId: brand!.id, title: 'Concorrenza' })
    .$returningId();

  const ids: number[] = [];
  for (let i = 0; i < PUBLICATIONS; i++) {
    // Una variant per pubblicazione; il vincolo (contenuto, piattaforma) impone contenuti distinti.
    const [ownContent] =
      i === 0
        ? [content]
        : await db
            .insert(contents)
            .values({ brandId: brand!.id, title: `Concorrenza ${i}` })
            .$returningId();
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
      .$returningId();
    const [publication] = await db
      .insert(publications)
      .values({
        variantId: variant!.id,
        socialAccountId: account!.id,
        scheduledAt: DUE_AT,
        nextAttemptAt: DUE_AT,
        idempotencyKey: `${MARKER}-${variant!.id}`,
      })
      .$returningId();
    ids.push(publication!.id);
  }
  return ids;
}

describe.skipIf(!databaseUrl)('scheduler con più worker in parallelo (MySQL)', () => {
  const connections = Array.from({ length: WORKERS + 1 }, () => createDatabase(databaseUrl!));
  const admin = connections[0]!.db;

  beforeAll(() => cleanup(admin));

  afterAll(async () => {
    await cleanup(admin);
    await Promise.all(connections.map((c) => c.pool.end()));
  });

  it('pubblica ogni post una sola volta anche con worker concorrenti', async () => {
    const ids = await seed(admin);
    const publisher = new FakePublisher('tiktok');
    publisher.delayMs = 30; // allarga la finestra in cui i worker si sovrappongono

    const workers = connections.slice(1).map((connection, index) =>
      createScheduler({
        db: connection.db,
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
