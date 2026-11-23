import type { Readable } from 'node:stream';
import { nodeStreamPut, type StreamPut } from '../stream-put.js';

/**
 * Client per TikTok for Developers (API v2). Riferimenti verificati (developers.tiktok.com,
 * novembre 2026):
 * - OAuth: /doc/login-kit-web, /doc/oauth-user-access-token-management (token di accesso 2 ore,
 *   refresh token 180 giorni che ruota a ogni rinnovo)
 * - Profilo: /doc/tiktok-api-v2-get-user-info (`display_name` con `user.info.basic`)
 * - Casella: /doc/content-posting-api-reference-upload-video, /doc/content-posting-api-media-transfer-guide
 * - Stato: /doc/content-posting-api-reference-get-video-status
 */

export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_API_URL = 'https://open.tiktokapis.com';

/**
 * Profilo di base e caricamento nella casella; dalla fase 4 anche `video.list` (statistiche dei
 * video pubblici, Display API) e `user.info.stats` (follower). Va ricollegato l'account.
 */
export const TIKTOK_SCOPES = [
  'user.info.basic',
  'video.upload',
  'video.list',
  'user.info.stats',
] as const;

export type FetchFn = typeof fetch;

export interface TikTokTokens {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresInSeconds: number;
  openId: string;
}

/** Stati di `status/fetch` per i caricamenti nella casella. */
export type TikTokPublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

/** Risposta non riuscita di TikTok, con il codice d'errore (`error.code`, es. `rate_limit_exceeded`). */
export class TikTokHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    detail: string,
  ) {
    super(`TikTok ha risposto ${status}${code ? ` (${code})` : ''}: ${detail}`);
    this.name = 'TikTokHttpError';
  }
}

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  // OAuth risponde senza busta.
  [key: string]: unknown;
}

function parse(status: number, text: string): Envelope {
  let json: Envelope;
  try {
    json = (text ? JSON.parse(text) : {}) as Envelope;
  } catch {
    throw new TikTokHttpError(status, null, text.slice(0, 300));
  }
  const code = json.error?.code ?? (typeof json.error === 'string' ? json.error : null);
  if (status >= 400 || (code && code !== 'ok')) {
    const message =
      json.error?.message ??
      (typeof json.error_description === 'string' ? json.error_description : text);
    throw new TikTokHttpError(status, code ?? null, String(message).slice(0, 300));
  }
  return json;
}

export function authorizationUrl(params: {
  clientKey: string;
  redirectUri: string;
  state: string;
  /** PKCE di Login Kit for Desktop: SHA-256 del verifier in esadecimale. */
  codeChallenge?: string;
}): string {
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set('client_key', params.clientKey);
  url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  if (params.codeChallenge) {
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/**
 * Pezzi del caricamento (media transfer guide): fino a 64 MB un solo pezzo; oltre, pezzi da
 * 10 MB e l'avanzo accorpato all'ultimo (che può arrivare a 128 MB).
 */
export function chunkPlan(sizeBytes: number, chunkBytes = 10 * 1024 * 1024) {
  if (sizeBytes <= 64 * 1024 * 1024) {
    return {
      chunkSize: sizeBytes,
      count: 1,
      ranges: [[0, sizeBytes - 1]] as Array<[number, number]>,
    };
  }
  const count = Math.floor(sizeBytes / chunkBytes);
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkBytes;
    ranges.push([start, i === count - 1 ? sizeBytes - 1 : start + chunkBytes - 1]);
  }
  return { chunkSize: chunkBytes, count, ranges };
}

export function createTikTokClient(
  options: { fetch?: FetchFn; put?: StreamPut; apiUrl?: string } = {},
) {
  const doFetch = options.fetch ?? fetch;
  const put = options.put ?? nodeStreamPut;
  const api = options.apiUrl ?? TIKTOK_API_URL;

  async function send(path: string, init: RequestInit): Promise<Envelope> {
    const response = await doFetch(`${api}${path}`, init);
    return parse(response.status, await response.text());
  }

  function tokens(json: Envelope): TikTokTokens {
    const { access_token, refresh_token, open_id, expires_in, refresh_expires_in } = json;
    if (
      typeof access_token !== 'string' ||
      typeof refresh_token !== 'string' ||
      typeof open_id !== 'string'
    ) {
      throw new Error('Risposta di TikTok senza token');
    }
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      openId: open_id,
      expiresInSeconds: typeof expires_in === 'number' ? expires_in : 7200,
      refreshExpiresInSeconds:
        typeof refresh_expires_in === 'number' ? refresh_expires_in : 180 * 86_400,
    };
  }

  function form(values: Record<string, string>): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    };
  }

  function json(accessToken: string, body?: unknown): RequestInit {
    return {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  }

  return {
    async exchangeCode(params: {
      code: string;
      clientKey: string;
      clientSecret: string;
      redirectUri: string;
      codeVerifier?: string;
    }): Promise<TikTokTokens> {
      return tokens(
        await send(
          '/v2/oauth/token/',
          form({
            client_key: params.clientKey,
            client_secret: params.clientSecret,
            code: params.code,
            grant_type: 'authorization_code',
            redirect_uri: params.redirectUri,
            ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
          }),
        ),
      );
    },

    /** Rinnovo: restituisce anche un refresh token nuovo, che sostituisce subito il vecchio. */
    async refresh(params: {
      refreshToken: string;
      clientKey: string;
      clientSecret: string;
    }): Promise<TikTokTokens> {
      return tokens(
        await send(
          '/v2/oauth/token/',
          form({
            client_key: params.clientKey,
            client_secret: params.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: params.refreshToken,
          }),
        ),
      );
    },

    async getProfile(accessToken: string): Promise<{ openId: string; displayName: string }> {
      const response = await send('/v2/user/info/?fields=open_id,display_name', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = (response.data?.user ?? {}) as { open_id?: unknown; display_name?: unknown };
      if (typeof user.open_id !== 'string') throw new Error('Profilo TikTok senza open_id');
      return {
        openId: user.open_id,
        displayName:
          typeof user.display_name === 'string' && user.display_name
            ? user.display_name
            : user.open_id,
      };
    },

    /** Apre il caricamento nella casella (FILE_UPLOAD): `publish_id` e indirizzo per i pezzi (vale 1 ora). */
    async initInboxUpload(
      accessToken: string,
      sizeBytes: number,
      plan: { chunkSize: number; count: number },
    ): Promise<{ publishId: string; uploadUrl: string }> {
      const response = await send(
        '/v2/post/publish/inbox/video/init/',
        json(accessToken, {
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: sizeBytes,
            chunk_size: plan.chunkSize,
            total_chunk_count: plan.count,
          },
        }),
      );
      const { publish_id, upload_url } = (response.data ?? {}) as {
        publish_id?: unknown;
        upload_url?: unknown;
      };
      if (typeof publish_id !== 'string' || typeof upload_url !== 'string') {
        throw new Error('Risposta di TikTok senza publish_id o upload_url');
      }
      return { publishId: publish_id, uploadUrl: upload_url };
    },

    /** Un pezzo del video: 206 = altri pezzi attesi, 201 = tutto ricevuto. */
    async uploadChunk(
      uploadUrl: string,
      body: Readable,
      range: [number, number],
      sizeBytes: number,
      mime: string,
    ): Promise<'partial' | 'complete'> {
      const response = await put(
        uploadUrl,
        {
          'Content-Type': mime,
          'Content-Length': String(range[1] - range[0] + 1),
          'Content-Range': `bytes ${range[0]}-${range[1]}/${sizeBytes}`,
        },
        body,
      );
      if (response.status === 201) return 'complete';
      if (response.status === 206) return 'partial';
      throw new TikTokHttpError(
        response.status,
        null,
        response.body.slice(0, 300) || 'caricamento rifiutato',
      );
    },

    async fetchStatus(
      accessToken: string,
      publishId: string,
    ): Promise<{ status: TikTokPublishStatus; failReason: string | null; postIds: string[] }> {
      const response = await send(
        '/v2/post/publish/status/fetch/',
        json(accessToken, { publish_id: publishId }),
      );
      const data = (response.data ?? {}) as {
        status?: unknown;
        fail_reason?: unknown;
        publicaly_available_post_id?: unknown;
      };
      if (typeof data.status !== 'string') throw new Error('Stato TikTok senza status');
      return {
        status: data.status as TikTokPublishStatus,
        failReason: typeof data.fail_reason === 'string' ? data.fail_reason : null,
        // Il nome del campo è scritto così nella documentazione («publicaly»).
        postIds: Array.isArray(data.publicaly_available_post_id)
          ? data.publicaly_available_post_id.map(String)
          : [],
      };
    },

    /** Statistiche di un video pubblico (Display API, scope `video.list`). */
    async queryVideo(
      accessToken: string,
      videoId: string,
    ): Promise<{
      id: string;
      shareUrl: string | null;
      views: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
    } | null> {
      const response = await send(
        '/v2/video/query/?fields=id,share_url,view_count,like_count,comment_count,share_count',
        json(accessToken, { filters: { video_ids: [videoId] } }),
      );
      const video = ((response.data?.videos as Array<Record<string, unknown>> | undefined) ??
        [])[0];
      if (!video) return null;
      const num = (value: unknown) => (typeof value === 'number' ? value : null);
      return {
        id: String(video.id),
        shareUrl: typeof video.share_url === 'string' ? video.share_url : null,
        views: num(video.view_count),
        likes: num(video.like_count),
        comments: num(video.comment_count),
        shares: num(video.share_count),
      };
    },

    /** Follower attuali (scope `user.info.stats`). */
    async followerCount(accessToken: string): Promise<number | null> {
      const response = await send('/v2/user/info/?fields=follower_count', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = (response.data?.user ?? {}) as { follower_count?: unknown };
      return typeof user.follower_count === 'number' ? user.follower_count : null;
    },
  };
}

export type TikTokClient = ReturnType<typeof createTikTokClient>;
