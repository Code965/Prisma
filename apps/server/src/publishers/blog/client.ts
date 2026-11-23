/**
 * Client della «Blog API» di Prisma: un contratto minimo che qualsiasi sito può implementare
 * (documentato in `docs/blog-api.md`). L'indirizzo base lo sceglie l'utente:
 * - `GET  {base}/health`
 * - `POST {base}/articles` con `{ title, html, idempotencyKey, description?, tags? }`
 * Autenticazione: `Authorization: Bearer <chiave API del sito>`.
 */

export type FetchFn = typeof fetch;

export interface BlogArticleRequest {
  title: string;
  html: string;
  idempotencyKey: string;
  /** Estratto per la meta description. */
  description?: string;
  tags?: string[];
}

export interface BlogArticleResponse {
  id: number;
  url: string;
  duplicate: boolean;
}

/** Risposta non riuscita del sito, con il codice d'errore che restituisce (`not_configured`…). */
export class BlogHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    detail: string,
  ) {
    super(`Il sito ha risposto ${status}: ${detail}`);
    this.name = 'BlogHttpError';
  }
}

/**
 * Indirizzo dell'API del sito normalizzato (senza "/" finale). Serve https, tranne in locale.
 * Restituisce null se non è un indirizzo valido.
 */
export function normalizeBlogBaseUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.search || url.hash || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Il sito non ha una chiave API impostata (anche nella forma italiana delle prime versioni). */
export function isNotConfigured(error: BlogHttpError): boolean {
  return error.code === 'not_configured' || error.code === 'non_configurato';
}

export function createBlogClient(options: { fetch?: FetchFn; timeoutMs?: number } = {}) {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function send(url: string, init: RequestInit): Promise<unknown> {
    const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const data = (body ?? {}) as { error?: unknown; message?: unknown };
      throw new BlogHttpError(
        response.status,
        typeof data.error === 'string' ? data.error : null,
        typeof data.message === 'string' ? data.message : String(text).slice(0, 200),
      );
    }
    return body;
  }

  const headers = (apiKey: string) => ({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  });

  return {
    async health(baseUrl: string, apiKey: string): Promise<void> {
      await send(`${baseUrl}/health`, { headers: headers(apiKey) });
    },

    async createArticle(
      baseUrl: string,
      apiKey: string,
      article: BlogArticleRequest,
    ): Promise<BlogArticleResponse> {
      const body = (await send(`${baseUrl}/articles`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify(article),
      })) as { id?: unknown; url?: unknown; duplicate?: unknown };
      if (typeof body?.id !== 'number' || typeof body.url !== 'string') {
        throw new Error('Risposta del sito senza id o indirizzo dell’articolo');
      }
      return { id: body.id, url: body.url, duplicate: body.duplicate === true };
    },
  };
}

export type BlogClient = ReturnType<typeof createBlogClient>;
