import { afterAll, describe, expect, it } from 'vitest';
import type { Content, Idea, PlanState } from '@prisma-app/shared';
import { publications } from '../src/db/schema.js';
import { FakeLlm } from './helpers/fake-llm.js';
import {
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

/** Nel 1990 come gli altri test con orologio: il 10 marzo 1990 era un sabato. */
const NOW = new Date('1990-03-10T12:00:00.000Z');

async function scheduledPost(ctx: TestContext, brandId: number, accountId: number) {
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Uscita già fissata', platforms: ['linkedin'] },
    })
  ).json<Content>();
  await ctx.tx.insert(publications).values({
    variantId: content.variants[0]!.id,
    socialAccountId: accountId,
    scheduledAt: new Date('1990-03-17T08:00:00.000Z'),
    status: 'programmato',
    idempotencyKey: 'piano'.padEnd(64, 'x'),
  });
}

const frequency = {
  platform: 'linkedin',
  perWeek: 2,
  formats: ['post', 'carosello'],
  slots: [{ weekday: 1, hour: 8 }],
  note: 'Due uscite reggono il ritmo.',
};

const pillars = [
  { name: 'Rust in pratica', description: 'Esempi da progetti veri.', tag: 'Rust' },
  { name: 'Strumenti', description: 'Strumenti provati sul campo.', tag: null },
  { name: 'Carriera', description: 'Il lavoro da sviluppatore.', tag: null },
];

describe.skipIf(!databaseUrl)('piano editoriale', () => {
  afterAll(closeDatabase);

  it('genera il piano, crea le idee, rivede il mese e rigenera tenendo le idee create', async () => {
    const llm = new FakeLlm();
    await withRollback(
      async (ctx) => {
        const brandId = await ctx.createBrand();
        const accountId = await ctx.createAccount(brandId, 'linkedin');
        const tag = (
          await ctx.call({
            method: 'POST',
            url: `/brands/${brandId}/tags`,
            payload: { name: 'Rust' },
          })
        ).json<{ id: number }>();
        await scheduledPost(ctx, brandId, accountId);
        const url = `/brands/${brandId}/plans/1990-03`;

        const empty = (await ctx.call({ method: 'GET', url })).json<PlanState>();
        expect(empty).toMatchObject({
          plan: null,
          review: null,
          blocked: null,
          booked: [{ day: '1990-03-17', platform: 'linkedin', title: 'Uscita già fissata' }],
        });

        llm.responses.push({
          summary: 'Un mese su Rust in produzione.',
          pillars,
          frequencies: [frequency],
          items: [
            {
              day: 13,
              platform: 'linkedin',
              format: 'post',
              pillar: 0,
              text: 'Il borrow checker in produzione',
              source: 'pilastro',
              ref: null,
            },
            {
              day: 14,
              platform: 'linkedin',
              format: 'carosello',
              pillar: 1,
              text: 'Tre strumenti per il profiling',
              source: 'pilastro',
              ref: null,
            },
          ],
        });
        const generated = await ctx.call({ method: 'POST', url, payload: {} });
        expect(generated.statusCode).toBe(201);
        const state = generated.json<PlanState>();
        expect(state.plan).toMatchObject({
          model: 'fake',
          pillars: [{ name: 'Rust in pratica', tagId: tag.id }, {}, {}],
          frequencies: [{ platform: 'linkedin', perWeek: 2 }],
          items: [
            { id: 'i0', day: '1990-03-13', hour: 8, pillar: 'Rust in pratica', ideaId: null },
            { id: 'i1', day: '1990-03-14', hour: 8, format: 'carosello', ideaId: null },
          ],
        });
        // Il modello vede i giorni liberi (dall'11) e l'uscita già fissata.
        expect(llm.lastPrompt()).toContain('- 11 dom');
        expect(llm.lastPrompt()).not.toContain('- 10 sab');
        expect(llm.lastPrompt()).toContain('17 · LinkedIn · Uscita già fissata');
        expect(llm.lastPrompt()).toContain(
          'LinkedIn: mar 08:00, mer 08:00, gio 08:00 (predefiniti)',
        );
        expect(state.review).toMatchObject({
          totals: { items: 2, ideas: 0, scheduled: 0, late: 0 },
          platforms: [{ platform: 'linkedin', planned: 2, target: 9, scheduled: 1 }],
          outsidePlan: 1,
        });

        // «Metti nel calendario» e «Crea l'idea»: solo idee.
        const placed = (
          await ctx.call({
            method: 'POST',
            url: `${url}/ideas`,
            payload: { itemIds: ['i0'], withDay: true },
          })
        ).json<PlanState>();
        const ideaId = placed.plan!.items[0]!.ideaId!;
        const idea = (await ctx.call({ method: 'GET', url: `/ideas/${ideaId}` })).json<Idea>();
        expect(idea).toMatchObject({
          source: 'suggerita',
          status: 'nuova',
          plannedDay: '1990-03-13',
          targetPlatforms: ['linkedin'],
          tags: [{ name: 'Rust' }],
        });
        expect(idea.text).toContain('Il borrow checker in produzione');
        expect(idea.text).toContain('Formato: post · Pilastro: Rust in pratica');
        expect(placed.review!.items[0]).toMatchObject({ progress: 'idea', late: false });

        const created = (
          await ctx.call({
            method: 'POST',
            url: `${url}/ideas`,
            payload: { itemIds: ['i1'], withDay: false },
          })
        ).json<PlanState>();
        const second = created.plan!.items[1]!.ideaId!;
        expect(
          (await ctx.call({ method: 'GET', url: `/ideas/${second}` })).json<Idea>().plannedDay,
        ).toBeNull();
        await ctx.call({ method: 'POST', url: `${url}/ideas`, payload: { itemIds: ['i1'] } });
        expect(
          (await ctx.call({ method: 'GET', url: `/ideas/${second}` })).json<Idea>().plannedDay,
        ).toBe('1990-03-14');
        const ideas = (await ctx.call({ method: 'GET', url: `/brands/${brandId}/ideas` })).json<
          Idea[]
        >();
        expect(ideas).toHaveLength(2);

        expect(
          (await ctx.call({ method: 'POST', url: `${url}/ideas`, payload: { itemIds: ['i9'] } }))
            .statusCode,
        ).toBe(422);

        // Commento dell'AI sulla revisione: solo i numeri del confronto.
        llm.responses.push({ comment: 'Hai già 2 idee pronte: trasformane una in bozza.' });
        const commented = (
          await ctx.call({ method: 'POST', url: `${url}/review` })
        ).json<PlanState>();
        expect(commented.plan!.reviewComment).toMatchObject({ model: 'fake' });
        expect(llm.lastPrompt()).toContain('idee create: 2');

        // Rigenerare tiene le idee già create e toglie il commento.
        llm.responses.push({
          summary: 'Secondo piano.',
          pillars,
          frequencies: [frequency],
          items: [
            {
              day: 20,
              platform: 'linkedin',
              format: 'post',
              pillar: 2,
              text: 'Come preparo un colloquio tecnico',
              source: 'pilastro',
              ref: null,
            },
          ],
        });
        const again = (await ctx.call({ method: 'POST', url, payload: {} })).json<PlanState>();
        expect(again.plan!.items.map((i) => [i.id, i.day, i.ideaId !== null])).toEqual([
          ['i0', '1990-03-13', true],
          ['i1', '1990-03-14', true],
          ['i2', '1990-03-20', false],
        ]);
        expect(again.plan!.reviewComment).toBeNull();
        expect(llm.lastPrompt()).toContain('13 · LinkedIn · idea già creata');

        // Niente pubblicazioni nuove: solo quella fissata prima.
        expect(await ctx.tx.select().from(publications)).toHaveLength(1);

        // Mese passato: si può leggere, non generare.
        const past = `/brands/${brandId}/plans/1990-02`;
        expect((await ctx.call({ method: 'GET', url: past })).json<PlanState>().blocked).toMatch(
          /Mese passato/,
        );
        expect((await ctx.call({ method: 'POST', url: past, payload: {} })).statusCode).toBe(422);
        expect(
          (await ctx.call({ method: 'GET', url: `/brands/${brandId}/plans/1990-13` })).statusCode,
        ).toBe(400);
      },
      { now: NOW, llm },
    );
  });
});
