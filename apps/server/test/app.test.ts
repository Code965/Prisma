import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const TOKEN = 'a'.repeat(64);

describe('app HTTP', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  async function start(checkDatabase: () => Promise<void> = async () => {}) {
    app = await buildApp({ apiToken: TOKEN, checkDatabase });
    return app;
  }

  it('espone /health senza token', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('risponde 503 da /health se il database non risponde', async () => {
    const res = await (
      await start(async () => {
        throw new Error('ECONNREFUSED');
      })
    ).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
  });

  it('rifiuta le richieste senza token', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'non_autorizzato' });
  });

  it('rifiuta un token sbagliato', async () => {
    const res = await (
      await start()
    ).inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${'b'.repeat(64)}` } });
    expect(res.statusCode).toBe(401);
  });

  it('accetta il token corretto', async () => {
    const res = await (
      await start()
    ).inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
  });

  it('non tratta come pubblico un percorso che inizia come /health', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(401);
  });
});
