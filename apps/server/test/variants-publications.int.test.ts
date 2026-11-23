import { afterAll, describe, expect, it } from 'vitest';
import type { Content, PublicationView, Variant, VariantRevision } from '@prisma-app/shared';
import { applyPublicationTransition } from '../src/modules/publications/transitions.js';
import {
  closeDatabase,
  databaseUrl,
  NOW,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const LATER = '2026-11-22T17:00:00.000Z';

async function createVariant(ctx: TestContext, brandId: number): Promise<Variant> {
  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Client database in .NET', platforms: ['linkedin'] },
    })
  ).json<Content>();
  return content.variants[0]!;
}

async function edit(ctx: TestContext, variant: Variant, body: string) {
  return ctx.call({
    method: 'PATCH',
    url: `/variants/${variant.id}`,
    payload: { body, metadata: { hashtags: ['dotnet'] }, expectedVersion: variant.version },
  });
}

async function transition(ctx: TestContext, variant: Variant, action: string) {
  return ctx.call({
    method: 'POST',
    url: `/variants/${variant.id}/transitions`,
    payload: { action, expectedVersion: variant.version },
  });
}

/** Porta una variant nuova fino ad `approvato`. */
async function approvedVariant(ctx: TestContext, brandId: number): Promise<Variant> {
  let variant = await createVariant(ctx, brandId);
  variant = (await edit(ctx, variant, 'Ho costruito un client database')).json<Variant>();
  variant = (await transition(ctx, variant, 'submit')).json<Variant>();
  return (await transition(ctx, variant, 'approve')).json<Variant>();
}

describe.skipIf(!databaseUrl)('API variant (MySQL)', () => {
  afterAll(closeDatabase);

  it('percorre bozza → da approvare → approvato con versioni e revisioni', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      let variant = await createVariant(ctx, brandId);
      expect(variant).toMatchObject({ status: 'bozza', version: 0 });

      variant = (await edit(ctx, variant, 'Prima versione')).json<Variant>();
      expect(variant).toMatchObject({ status: 'bozza', body: 'Prima versione' });
      expect(variant.metadata.hashtags).toEqual(['#dotnet']);

      variant = (await transition(ctx, variant, 'submit')).json<Variant>();
      expect(variant.status).toBe('da_approvare');

      variant = (await transition(ctx, variant, 'approve')).json<Variant>();
      expect(variant.status).toBe('approvato');
      expect(variant.approvedAt).toBe(NOW.toISOString());

      const revisions = await ctx.call({ method: 'GET', url: `/variants/${variant.id}/revisions` });
      expect(revisions.json<VariantRevision[]>()).toHaveLength(1);
    }));

  it('riporta a bozza una variant approvata quando viene modificata', () =>
    withRollback(async (ctx) => {
      const variant = await approvedVariant(ctx, await ctx.createBrand());
      const edited = (await edit(ctx, variant, 'Testo cambiato')).json<Variant>();
      expect(edited).toMatchObject({ status: 'bozza', approvedAt: null });
    }));

  it('rifiuta versioni superate e transizioni non ammesse con 409', () =>
    withRollback(async (ctx) => {
      const variant = await createVariant(ctx, await ctx.createBrand());
      await edit(ctx, variant, 'uno');

      const stale = await edit(ctx, variant, 'due');
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ error: 'conflitto_versione' });

      const fresh = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
      ).json<Variant>();
      const skip = await transition(ctx, fresh, 'approve');
      expect(skip.statusCode).toBe(409);
      expect(skip.json()).toMatchObject({ error: 'transizione_non_valida' });
    }));

  it('non accetta azioni di sistema dall’API', () =>
    withRollback(async (ctx) => {
      const variant = await createVariant(ctx, await ctx.createBrand());
      expect((await transition(ctx, variant, 'schedule')).statusCode).toBe(400);
    }));
});

describe.skipIf(!databaseUrl)('API pubblicazioni (MySQL)', () => {
  afterAll(closeDatabase);

  async function schedule(ctx: TestContext, variantId: number, accountId: number, at = LATER) {
    return ctx.call({
      method: 'POST',
      url: '/publications',
      payload: { variantId, socialAccountId: accountId, scheduledAt: at },
    });
  }

  it('programma solo variant approvate', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const accountId = await ctx.createAccount(brandId, 'linkedin');
      const draft = await createVariant(ctx, brandId);

      const refused = await schedule(ctx, draft.id, accountId);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: 'transizione_non_valida' });
    }));

  it('programma, sposta, pubblica ora e annulla tenendo allineata la variant', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const accountId = await ctx.createAccount(brandId, 'linkedin');
      const variant = await approvedVariant(ctx, brandId);

      const created = await schedule(ctx, variant.id, accountId);
      expect(created.statusCode).toBe(201);
      const publication = created.json<PublicationView>();
      expect(publication).toMatchObject({
        status: 'programmato',
        scheduledAt: LATER,
        nextAttemptAt: LATER,
        platform: 'linkedin',
        contentTitle: 'Client database in .NET',
      });

      const scheduled = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
      ).json<Variant>();
      expect(scheduled.status).toBe('programmato');
      expect((await edit(ctx, scheduled, 'modifica vietata')).statusCode).toBe(409);

      const moved = await ctx.call({
        method: 'PATCH',
        url: `/publications/${publication.id}`,
        payload: { scheduledAt: '2026-11-23T08:00:00+01:00' },
      });
      expect(moved.json<PublicationView>().scheduledAt).toBe('2026-11-23T07:00:00.000Z');

      const now = await ctx.call({
        method: 'POST',
        url: `/publications/${publication.id}/publish-now`,
      });
      expect(now.json<PublicationView>().nextAttemptAt).toBe(NOW.toISOString());

      const cancelled = await ctx.call({
        method: 'POST',
        url: `/publications/${publication.id}/cancel`,
      });
      expect(cancelled.json<PublicationView>().status).toBe('annullato');
      const back = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
      ).json<Variant>();
      expect(back.status).toBe('approvato');

      // Dopo l'annullamento si può riprogrammare: la versione è cambiata, quindi la chiave è nuova.
      expect((await schedule(ctx, variant.id, accountId)).statusCode).toBe(201);
    }));

  it('rifiuta account di un’altra piattaforma e orari passati', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const youtube = await ctx.createAccount(brandId, 'youtube');
      const linkedin = await ctx.createAccount(brandId, 'linkedin');
      const variant = await approvedVariant(ctx, brandId);

      expect((await schedule(ctx, variant.id, youtube)).statusCode).toBe(422);
      expect((await schedule(ctx, variant.id, linkedin, '2026-11-20T10:00:00Z')).statusCode).toBe(
        422,
      );
    }));

  it('riprova una pubblicazione in errore ripartendo da zero tentativi', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const accountId = await ctx.createAccount(brandId, 'linkedin');
      const variant = await approvedVariant(ctx, brandId);
      const publication = (await schedule(ctx, variant.id, accountId)).json<PublicationView>();

      // Simula lo scheduler: parte e fallisce definitivamente.
      await applyPublicationTransition(ctx.tx, publication.id, 'start', { now: NOW });
      await applyPublicationTransition(ctx.tx, publication.id, 'fail', {
        now: NOW,
        values: { attempts: 5, lastError: 'timeout' },
      });
      const failed = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
      ).json<Variant>();
      expect(failed.status).toBe('errore');

      const retried = await ctx.call({
        method: 'POST',
        url: `/publications/${publication.id}/retry`,
      });
      expect(retried.json<PublicationView>()).toMatchObject({
        status: 'programmato',
        attempts: 0,
        lastError: null,
      });
      const variantAfter = (
        await ctx.call({ method: 'GET', url: `/variants/${variant.id}` })
      ).json<Variant>();
      expect(variantAfter.status).toBe('programmato');
    }));

  it('elenca per intervallo e stato e protegge i contenuti con storico', () =>
    withRollback(async (ctx) => {
      const brandId = await ctx.createBrand();
      const accountId = await ctx.createAccount(brandId, 'linkedin');
      const variant = await approvedVariant(ctx, brandId);
      await schedule(ctx, variant.id, accountId);

      const inRange = await ctx.call({
        method: 'GET',
        url: `/publications?brandId=${brandId}&from=2026-11-22T00:00:00Z&to=2026-11-23T00:00:00Z&status=programmato`,
      });
      expect(inRange.json<PublicationView[]>()).toHaveLength(1);

      const outOfRange = await ctx.call({
        method: 'GET',
        url: `/publications?brandId=${brandId}&from=2026-11-23T00:00:00Z`,
      });
      expect(outOfRange.json<PublicationView[]>()).toHaveLength(0);

      const remove = await ctx.call({ method: 'DELETE', url: `/contents/${variant.contentId}` });
      expect(remove.statusCode).toBe(409);
    }));
});
