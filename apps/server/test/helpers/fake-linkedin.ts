import type { FetchFn } from '../../src/publishers/linkedin/client.js';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  /** Byte inviati quando il corpo è binario (caricamento del documento). */
  bodyBytes: number | null;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * `fetch` finto per le API LinkedIn: le risposte si configurano per prefisso di URL,
 * le richieste vengono registrate per controllare header e corpo.
 */
export class FakeLinkedIn {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: [string, Handler][] = [];

  on(urlPrefix: string, handler: Handler): this {
    this.routes.unshift([urlPrefix, handler]);
    return this;
  }

  readonly fetch: FetchFn = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body && !(init.body instanceof Uint8Array) ? String(init.body) : '',
      bodyBytes: init?.body instanceof Uint8Array ? init.body.byteLength : null,
    };
    this.requests.push(request);
    const route = this.routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) return new Response(`Nessuna risposta finta per ${url}`, { status: 404 });
    return route[1](request);
  };

  /** Configurazione tipica: token, profilo, post e commento creati. */
  static happyPath(): FakeLinkedIn {
    return new FakeLinkedIn()
      .on('https://www.linkedin.com/oauth/v2/accessToken', () =>
        Response.json({
          access_token: 'access-123',
          expires_in: 5_184_000,
          scope: 'openid,profile,w_member_social',
        }),
      )
      .on('https://api.linkedin.com/v2/userinfo', () =>
        Response.json({ sub: 'abc123', name: 'Marta Rossi' }),
      )
      .on(
        'https://api.linkedin.com/rest/posts',
        () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7000' } }),
      )
      .on('https://api.linkedin.com/rest/documents?action=initializeUpload', () =>
        Response.json({
          value: {
            uploadUrlExpiresAt: 1_795_000_000_000,
            uploadUrl: 'https://www.linkedin.com/dms-uploads/doc-1?ca=x',
            document: 'urn:li:document:D1',
          },
        }),
      )
      .on('https://www.linkedin.com/dms-uploads/', () => new Response(null, { status: 201 }))
      .on('https://api.linkedin.com/rest/documents/', () =>
        Response.json({ id: 'urn:li:document:D1', status: 'AVAILABLE' }),
      )
      .on(
        'https://api.linkedin.com/rest/socialActions/',
        () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:comment:1' } }),
      );
  }
}
