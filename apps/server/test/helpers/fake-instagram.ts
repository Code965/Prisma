import type { FetchFn } from '../../src/publishers/instagram/client.js';

export interface InstagramRequest {
  url: URL;
  method: string;
  params: URLSearchParams;
}

type Handler = (request: InstagramRequest) => Response | Promise<Response>;

/**
 * `fetch` finto per la Graph API di Instagram. Le rotte si configurano per metodo e percorso
 * (senza query); i parametri, che arrivino in query o nel corpo, finiscono in `params`.
 */
export class FakeInstagram {
  readonly requests: InstagramRequest[] = [];
  private readonly routes: Array<[string, Handler]> = [];
  private containers = 0;

  on(route: string, handler: Handler): this {
    this.routes.unshift([route, handler]);
    return this;
  }

  readonly fetch: FetchFn = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? 'GET';
    const params = new URLSearchParams(url.search);
    if (init?.body instanceof URLSearchParams) {
      for (const [key, value] of init.body) params.set(key, value);
    }
    const request = { url, method, params };
    this.requests.push(request);
    const key = `${method} ${url.origin}${url.pathname}`;
    // Percorso esatto; un `*` finale indica un prefisso (es. tutti i container c1, c2, …).
    const route = this.routes.find(([pattern]) =>
      pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern,
    );
    if (!route) return new Response(`Nessuna risposta finta per ${key}`, { status: 404 });
    return route[1](request);
  };

  /** Container creati in ordine (c1, c2, …), tutti subito pronti; quota libera. */
  static happyPath(): FakeInstagram {
    const fake = new FakeInstagram();
    return fake
      .on('POST https://api.instagram.com/oauth/access_token', () =>
        Response.json({
          data: [
            { access_token: 'breve-1', user_id: '1789', permissions: 'instagram_business_basic' },
          ],
        }),
      )
      .on('GET https://graph.instagram.com/access_token', () =>
        Response.json({ access_token: 'lungo-1', token_type: 'bearer', expires_in: 5_184_000 }),
      )
      .on('GET https://graph.instagram.com/refresh_access_token', () =>
        Response.json({ access_token: 'rinnovato-1', token_type: 'bearer', expires_in: 5_184_000 }),
      )
      .on('GET https://graph.instagram.com/v27.0/me', () =>
        Response.json({ data: [{ user_id: '1789', username: 'marta.dev' }] }),
      )
      .on('GET https://graph.instagram.com/v27.0/1789/content_publishing_limit', () =>
        Response.json({
          data: [{ quota_usage: 2, config: { quota_total: 50, quota_duration: 86400 } }],
        }),
      )
      .on('POST https://graph.instagram.com/v27.0/1789/media_publish', () =>
        Response.json({ id: 'm-100' }),
      )
      .on('POST https://graph.instagram.com/v27.0/1789/media', () =>
        Response.json({ id: `c${++fake.containers}` }),
      )
      .on('GET https://graph.instagram.com/v27.0/m-100', () =>
        Response.json({ permalink: 'https://www.instagram.com/p/ABC/' }),
      )
      .on('GET https://graph.instagram.com/v27.0/c*', () =>
        Response.json({ status_code: 'FINISHED' }),
      );
  }
}
