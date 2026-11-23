/**
 * Client HTTP per la «Instagram API with Instagram Login» (account professionali Business o Creator,
 * senza pagina Facebook). Riferimenti verificati (developers.facebook.com, novembre 2026):
 * - Login: /docs/instagram-platform/instagram-api-with-instagram-login/business-login
 * - Token: /docs/instagram-platform/reference/access_token, /reference/refresh_access_token
 * - Pubblicazione: /docs/instagram-platform/content-publishing (container, media_publish, status_code)
 * Le chiamate passano `access_token` come parametro, come negli esempi della documentazione.
 */

export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com';

/**
 * Profilo di base, pubblicazione e statistiche (i nomi `business_*` senza prefisso sono
 * deprecati). `instagram_business_manage_insights` dalla fase 4: chi aveva già collegato
 * l'account deve ricollegarlo.
 */
export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
] as const;

/**
 * Metriche dei post (FEED e REELS) in v27: `impressions` è deprecata per i media dopo il
 * 2 luglio 2024, `views` è «in development». I dati arrivano con fino a 48 ore di ritardo.
 */
export const MEDIA_INSIGHT_METRICS = [
  'reach',
  'views',
  'likes',
  'comments',
  'shares',
  'saved',
] as const;

/** Valore di una metrica: `values[0].value` (lifetime) o `total_value.value`. */
export function insightValue(entry: unknown): number | null {
  const item = entry as { values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } };
  const value = item.total_value?.value ?? item.values?.[0]?.value;
  return typeof value === 'number' ? value : null;
}

export type FetchFn = typeof fetch;

/** Stato di un container di pubblicazione (`status_code`). */
export type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

export interface InstagramToken {
  accessToken: string;
  expiresInSeconds: number;
}

export interface InstagramProfile {
  /** Id dell'account professionale (quello da usare negli endpoint di pubblicazione). */
  userId: string;
  username: string;
}

export interface PublishingQuota {
  usage: number;
  total: number;
}

/** Risposta non riuscita della Graph API, con il codice d'errore Meta quando c'è. */
export class InstagramHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly code: number | null,
  ) {
    super(`Instagram ha risposto ${status}: ${describe(body)}`);
    this.name = 'InstagramHttpError';
  }
}

function describe(body: string): string {
  try {
    const json = JSON.parse(body) as {
      error?: { message?: string };
      error_message?: string;
    };
    return (json.error?.message ?? json.error_message ?? body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function errorCode(body: string): number | null {
  try {
    const json = JSON.parse(body) as { error?: { code?: unknown }; code?: unknown };
    const code = json.error?.code ?? json.code;
    return typeof code === 'number' ? code : null;
  } catch {
    return null;
  }
}

/** Alcune risposte arrivano dentro `data: [...]`, altre no: si accettano entrambe. */
function unwrap(json: unknown): Record<string, unknown> {
  const value = json as { data?: unknown };
  if (Array.isArray(value?.data) && value.data[0] && typeof value.data[0] === 'object') {
    return value.data[0] as Record<string, unknown>;
  }
  return (json ?? {}) as Record<string, unknown>;
}

export function authorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
  url.searchParams.set('state', params.state);
  return url.toString();
}

/** Il codice nella callback può finire con `#_`, che non ne fa parte. */
export function cleanAuthorizationCode(code: string): string {
  return code.replace(/#_$/, '');
}

export function createInstagramClient(options: { apiVersion: string; fetch?: FetchFn }) {
  const doFetch = options.fetch ?? fetch;
  const graph = `${INSTAGRAM_GRAPH_URL}/${options.apiVersion}`;

  async function send(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await doFetch(url, init);
    const text = await response.text();
    if (!response.ok) throw new InstagramHttpError(response.status, text, errorCode(text));
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  function withToken(url: string, accessToken: string, params: Record<string, string> = {}) {
    const target = new URL(url);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    target.searchParams.set('access_token', accessToken);
    return target.toString();
  }

  function post(url: string, accessToken: string, params: Record<string, string>) {
    return send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, access_token: accessToken }),
    });
  }

  function requireString(json: Record<string, unknown>, field: string, what: string): string {
    const value = json[field];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`Risposta di Instagram senza ${what}`);
    }
    return String(value);
  }

  return {
    /** Codice di autorizzazione → token di breve durata (1 ora). */
    async exchangeCode(params: {
      code: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    }): Promise<{ accessToken: string; userId: string }> {
      const json = unwrap(
        await send(INSTAGRAM_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: params.clientId,
            client_secret: params.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: params.redirectUri,
            code: cleanAuthorizationCode(params.code),
          }),
        }),
      );
      return {
        accessToken: requireString(json, 'access_token', 'token'),
        userId: requireString(json, 'user_id', 'id utente'),
      };
    },

    /** Token di breve durata → token di 60 giorni (solo lato server: usa il segreto dell'app). */
    async exchangeLongLived(shortToken: string, clientSecret: string): Promise<InstagramToken> {
      const json = await send(
        withToken(`${INSTAGRAM_GRAPH_URL}/access_token`, shortToken, {
          grant_type: 'ig_exchange_token',
          client_secret: clientSecret,
        }),
      );
      return {
        accessToken: requireString(json, 'access_token', 'token'),
        expiresInSeconds: Number(json.expires_in ?? 0),
      };
    },

    /** Rinnovo: il token deve avere almeno 24 ore e non essere scaduto; vale altri 60 giorni. */
    async refreshToken(longToken: string): Promise<InstagramToken> {
      const json = await send(
        withToken(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`, longToken, {
          grant_type: 'ig_refresh_token',
        }),
      );
      return {
        accessToken: requireString(json, 'access_token', 'token'),
        expiresInSeconds: Number(json.expires_in ?? 0),
      };
    },

    async getProfile(accessToken: string): Promise<InstagramProfile> {
      const json = unwrap(
        await send(withToken(`${graph}/me`, accessToken, { fields: 'user_id,username' })),
      );
      return {
        userId: requireString(json, 'user_id', 'id dell’account'),
        username: requireString(json, 'username', 'nome utente'),
      };
    },

    /**
     * Statistiche di un post. Se una metrica non vale per quel tipo di media la richiesta
     * intera fallisce, quindi si riprova senza `views` (ancora «in development»).
     */
    async mediaInsights(
      accessToken: string,
      mediaId: string,
    ): Promise<Record<string, number | null>> {
      const request = (metrics: readonly string[]) =>
        send(withToken(`${graph}/${mediaId}/insights`, accessToken, { metric: metrics.join(',') }));
      let json: Record<string, unknown>;
      try {
        json = await request(MEDIA_INSIGHT_METRICS);
      } catch (error) {
        if (!(error instanceof InstagramHttpError) || error.status !== 400) throw error;
        json = await request(MEDIA_INSIGHT_METRICS.filter((m) => m !== 'views'));
      }
      const result: Record<string, number | null> = {};
      for (const entry of (json.data as Array<{ name?: string }> | undefined) ?? []) {
        if (entry.name) result[entry.name] = insightValue(entry);
      }
      return result;
    },

    /**
     * Copertura dell'account giorno per giorno (`metric_type=time_series`). `end_time` è la fine
     * del giorno a cui si riferisce il valore.
     */
    async accountReach(
      accessToken: string,
      igUserId: string,
      since: Date,
      until: Date,
    ): Promise<Array<{ endTime: string; value: number }>> {
      const json = await send(
        withToken(`${graph}/${igUserId}/insights`, accessToken, {
          metric: 'reach',
          period: 'day',
          metric_type: 'time_series',
          since: String(Math.floor(since.getTime() / 1000)),
          until: String(Math.floor(until.getTime() / 1000)),
        }),
      );
      const entry = (
        json.data as Array<{ values?: Array<{ value?: unknown; end_time?: unknown }> }>
      )?.[0];
      return (entry?.values ?? []).flatMap((v) =>
        typeof v.value === 'number' && typeof v.end_time === 'string'
          ? [{ endTime: v.end_time, value: v.value }]
          : [],
      );
    },

    /** Follower attuali (campo di base del profilo, senza insights). */
    async followersCount(accessToken: string, igUserId: string): Promise<number | null> {
      const json = unwrap(
        await send(withToken(`${graph}/${igUserId}`, accessToken, { fields: 'followers_count' })),
      );
      return typeof json.followers_count === 'number' ? json.followers_count : null;
    },

    async publishingQuota(accessToken: string, igUserId: string): Promise<PublishingQuota> {
      const json = unwrap(
        await send(
          withToken(`${graph}/${igUserId}/content_publishing_limit`, accessToken, {
            fields: 'quota_usage,config',
          }),
        ),
      );
      const config = (json.config ?? {}) as { quota_total?: unknown };
      return {
        usage: Number(json.quota_usage ?? 0),
        total: Number(config.quota_total ?? 50),
      };
    },

    /** Container di un'immagine: pubblicabile da solo (con didascalia) o come elemento di un carosello. */
    async createImageContainer(
      accessToken: string,
      igUserId: string,
      image: { imageUrl: string; caption?: string; carouselItem?: boolean },
    ): Promise<string> {
      const params: Record<string, string> = { image_url: image.imageUrl };
      if (image.carouselItem) params.is_carousel_item = 'true';
      if (image.caption) params.caption = image.caption;
      return requireString(
        await post(`${graph}/${igUserId}/media`, accessToken, params),
        'id',
        'id del container',
      );
    },

    async createCarouselContainer(
      accessToken: string,
      igUserId: string,
      children: readonly string[],
      caption: string,
    ): Promise<string> {
      const json = await post(`${graph}/${igUserId}/media`, accessToken, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption,
      });
      return requireString(json, 'id', 'id del container');
    },

    async containerStatus(accessToken: string, containerId: string): Promise<ContainerStatus> {
      const json = await send(
        withToken(`${graph}/${containerId}`, accessToken, { fields: 'status_code' }),
      );
      return requireString(json, 'status_code', 'stato del container') as ContainerStatus;
    },

    /** Pubblica il container: da qui in poi il post può essere online. */
    async publish(
      accessToken: string,
      igUserId: string,
      creationId: string,
    ): Promise<{ mediaId: string; configIssue: string | null }> {
      const json = await post(`${graph}/${igUserId}/media_publish`, accessToken, {
        creation_id: creationId,
      });
      return {
        mediaId: requireString(json, 'id', 'id del post'),
        configIssue: typeof json.config_issue === 'string' ? json.config_issue : null,
      };
    },

    async permalink(accessToken: string, mediaId: string): Promise<string | null> {
      const json = await send(
        withToken(`${graph}/${mediaId}`, accessToken, { fields: 'permalink' }),
      );
      return typeof json.permalink === 'string' ? json.permalink : null;
    },
  };
}

export type InstagramClient = ReturnType<typeof createInstagramClient>;
