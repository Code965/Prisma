import type { FetchFn } from '../../src/publishers/blog/client.js';

export interface BlogRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Finto sito con la Blog API: implementa /health e /articles con la stessa
 * deduplica per idempotencyKey del sito vero. `failNext` simula errori.
 */
export class FakeBlog {
  readonly requests: BlogRequest[] = [];
  readonly articles = new Map<string, number>();
  apiKey = 'c'.repeat(40);
  failNext: Array<{ status: number; body?: unknown } | 'network'> = [];

  readonly fetch: FetchFn = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    this.requests.push({ url, method: init?.method ?? 'GET', headers, body });

    const failure = this.failNext.shift();
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure)
      return Response.json(failure.body ?? { error: 'errore' }, { status: failure.status });

    if (headers.authorization !== `Bearer ${this.apiKey}`) {
      return Response.json(
        { error: 'non_autorizzato', message: 'Chiave API non valida' },
        { status: 401 },
      );
    }
    if (url.endsWith('/health')) return Response.json({ status: 'ok' });
    if (url.endsWith('/articles')) {
      const key = (body as { idempotencyKey: string }).idempotencyKey;
      const existing = this.articles.get(key);
      if (existing) {
        return Response.json({
          id: existing,
          url: `https://sito.test/blog/${existing}`,
          duplicate: true,
        });
      }
      const id = this.articles.size + 1;
      this.articles.set(key, id);
      return Response.json({ id, url: `https://sito.test/blog/${id}` }, { status: 201 });
    }
    return new Response('not found', { status: 404 });
  };
}
