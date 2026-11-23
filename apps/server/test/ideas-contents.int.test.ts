import { afterAll, describe, expect, it } from 'vitest';
import type { Content, Idea, Tag } from '@prisma-app/shared';
import { closeDatabase, databaseUrl, withRollback } from './helpers/integration.js';

describe.skipIf(!databaseUrl)('API idee e contenuti (MySQL)', () => {
  afterAll(closeDatabase);

  it('crea, filtra e aggiorna le idee con i tag', () =>
    withRollback(async ({ call, createBrand }) => {
      const brandId = await createBrand();
      const dotnet = (
        await call({ method: 'POST', url: `/brands/${brandId}/tags`, payload: { name: '.NET' } })
      ).json<Tag>();
      const gis = (
        await call({ method: 'POST', url: `/brands/${brandId}/tags`, payload: { name: 'GIS' } })
      ).json<Tag>();

      const created = await call({
        method: 'POST',
        url: `/brands/${brandId}/ideas`,
        payload: { text: 'WebForms nel 2026', tagIds: [dotnet.id], targetPlatforms: ['linkedin'] },
      });
      expect(created.statusCode).toBe(201);
      const idea = created.json<Idea>();
      expect(idea).toMatchObject({ status: 'nuova', source: 'scritta', tags: [{ name: '.NET' }] });

      await call({
        method: 'POST',
        url: `/brands/${brandId}/ideas`,
        payload: { text: 'Mappe in 10 righe di PyQGIS', tagIds: [gis.id] },
      });

      const filtered = await call({
        method: 'GET',
        url: `/brands/${brandId}/ideas?tagId=${gis.id}`,
      });
      expect(filtered.json<Idea[]>().map((i) => i.text)).toEqual(['Mappe in 10 righe di PyQGIS']);

      const updated = await call({
        method: 'PATCH',
        url: `/ideas/${idea.id}`,
        payload: { tagIds: [dotnet.id, gis.id], status: 'archiviata' },
      });
      expect(updated.json<Idea>().tags.map((t) => t.name)).toEqual(['.NET', 'GIS']);
      expect(updated.json<Idea>().status).toBe('archiviata');
    }));

  it('rifiuta tag di un altro brand e idee inesistenti', () =>
    withRollback(async ({ call, createBrand }) => {
      const mine = await createBrand();
      const other = await createBrand();
      const foreign = (
        await call({ method: 'POST', url: `/brands/${other}/tags`, payload: { name: 'Altro' } })
      ).json<Tag>();

      const res = await call({
        method: 'POST',
        url: `/brands/${mine}/ideas`,
        payload: { text: 'x', tagIds: [foreign.id] },
      });
      expect(res.statusCode).toBe(422);
      expect((await call({ method: 'GET', url: '/ideas/999999999' })).statusCode).toBe(404);
    }));

  it('rifiuta un tag duplicato con 409', () =>
    withRollback(async ({ call, createBrand }) => {
      const brandId = await createBrand();
      await call({ method: 'POST', url: `/brands/${brandId}/tags`, payload: { name: 'GIS' } });
      const dup = await call({
        method: 'POST',
        url: `/brands/${brandId}/tags`,
        payload: { name: 'GIS' },
      });
      expect(dup.statusCode).toBe(409);
    }));

  it('crea un contenuto da un’idea con una bozza per piattaforma', () =>
    withRollback(async ({ call, createBrand }) => {
      const brandId = await createBrand();
      const idea = (
        await call({ method: 'POST', url: `/brands/${brandId}/ideas`, payload: { text: 'Ollama' } })
      ).json<Idea>();

      const res = await call({
        method: 'POST',
        url: `/brands/${brandId}/contents`,
        payload: { ideaId: idea.id, title: 'Ollama in locale', platforms: ['linkedin', 'youtube'] },
      });
      expect(res.statusCode).toBe(201);
      const content = res.json<Content>();
      expect(content.variants.map((v) => [v.platform, v.format, v.status])).toEqual([
        ['linkedin', 'post', 'bozza'],
        ['youtube', 'video', 'bozza'],
      ]);

      const after = (await call({ method: 'GET', url: `/ideas/${idea.id}` })).json<Idea>();
      expect(after.status).toBe('in_lavorazione');

      const dupVariant = await call({
        method: 'POST',
        url: `/contents/${content.id}/variants`,
        payload: { platform: 'linkedin' },
      });
      expect(dupVariant.statusCode).toBe(409);

      const badFormat = await call({
        method: 'POST',
        url: `/contents/${content.id}/variants`,
        payload: { platform: 'tiktok', format: 'storia' },
      });
      expect(badFormat.statusCode).toBe(422);
    }));
});
