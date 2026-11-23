import type { Readable } from 'node:stream';

/**
 * Client per YouTube Data API v3. Riferimenti verificati (developers.google.com, novembre 2026):
 * - OAuth per app server: /youtube/v3/guides/auth/server-side-web-apps, /identity/protocols/oauth2
 * - Caricamento: /youtube/v3/docs/videos/insert, /youtube/v3/guides/using_resumable_upload_protocol
 * - Canale: /youtube/v3/docs/channels/list (`mine=true`, 1 unità)
 * - Modifica e cancellazione: /youtube/v3/docs/videos/update, /youtube/v3/docs/videos/delete
 */

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
/** YouTube Analytics API v2: va abilitata nel progetto Google Cloud, a parte dalla Data API. */
export const YOUTUBE_ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';

/**
 * `youtube` (gestione dell'account): oltre al caricamento servono `channels.list mine=true`,
 * `videos.update` (uscita programmata, «Pubblica ora») e `videos.delete` («Annulla»), che
 * `youtube.upload` da solo non copre.
 */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  // Fase 4: visualizzazioni e iscritti giorno per giorno (YouTube Analytics API).
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const;

export type FetchFn = typeof fetch;

export { nodeStreamPut, type RawResponse, type StreamPut } from '../stream-put.js';
import { nodeStreamPut, type RawResponse, type StreamPut } from '../stream-put.js';

/** Risposta non riuscita di Google, con il `reason` dell'errore quando c'è. */
export class GoogleHttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
    detail: string,
  ) {
    super(`YouTube ha risposto ${status}${reason ? ` (${reason})` : ''}: ${detail}`);
    this.name = 'GoogleHttpError';
  }
}

function parseError(status: number, body: string): GoogleHttpError {
  try {
    const json = JSON.parse(body) as {
      error?: string | { message?: string; errors?: Array<{ reason?: string }>; status?: string };
      error_description?: string;
    };
    if (typeof json.error === 'string') {
      return new GoogleHttpError(status, json.error, json.error_description ?? json.error);
    }
    const reason = json.error?.errors?.[0]?.reason ?? json.error?.status ?? null;
    return new GoogleHttpError(status, reason, (json.error?.message ?? body).slice(0, 300));
  } catch {
    return new GoogleHttpError(status, null, body.slice(0, 300));
  }
}

export interface GoogleTokens {
  accessToken: string;
  /** Presente solo alla prima autorizzazione (con `access_type=offline` e `prompt=consent`). */
  refreshToken: string | null;
  expiresInSeconds: number;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  customUrl: string | null;
}

/** Parte `snippet` e `status` di un video da caricare. */
export interface VideoMetadata {
  snippet: {
    title: string;
    description: string;
    tags?: string[];
    categoryId: string;
    defaultLanguage?: string;
  };
  status: {
    privacyStatus: 'public' | 'private' | 'unlisted';
    publishAt?: string;
    selfDeclaredMadeForKids: boolean;
  };
}

export interface VideoStatus {
  privacyStatus: string;
  publishAt?: string;
  uploadStatus?: string;
  [key: string]: unknown;
}

/** Esito di un PUT sulla sessione di caricamento. */
export type UploadOutcome =
  | { kind: 'done'; videoId: string }
  | { kind: 'incomplete'; uploadedBytes: number }
  | { kind: 'expired' };

export function authorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** PKCE S256 (app «Desktop» con ritorno su 127.0.0.1). */
  codeChallenge?: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  // Refresh token per caricare quando l'utente non c'è; `prompt=consent` lo fa emettere di nuovo.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', params.state);
  if (params.codeChallenge) {
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

function header(headers: RawResponse['headers'], name: string): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** `Range: bytes=0-999` → 1000 byte già ricevuti; senza Range nessuno. */
export function uploadedFromRange(range: string | null): number {
  const match = range ? /bytes=\d+-(\d+)/.exec(range) : null;
  return match ? Number(match[1]) + 1 : 0;
}

export function createYouTubeClient(
  options: {
    fetch?: FetchFn;
    put?: StreamPut;
    tokenUrl?: string;
    apiUrl?: string;
    uploadUrl?: string;
    analyticsUrl?: string;
  } = {},
) {
  const doFetch = options.fetch ?? fetch;
  const put = options.put ?? nodeStreamPut;
  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;
  const apiUrl = options.apiUrl ?? YOUTUBE_API_URL;
  const uploadUrl = options.uploadUrl ?? YOUTUBE_UPLOAD_URL;
  const analyticsUrl = options.analyticsUrl ?? YOUTUBE_ANALYTICS_URL;

  async function send(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await doFetch(url, init);
    const text = await response.text();
    if (!response.ok) throw parseError(response.status, text);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  function auth(accessToken: string, extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${accessToken}`, ...extra };
  }

  function tokens(json: Record<string, unknown>): GoogleTokens {
    if (typeof json.access_token !== 'string') throw new Error('Risposta di Google senza token');
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
      expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : 3600,
    };
  }

  function toOutcome(response: RawResponse): UploadOutcome {
    if (response.status === 200 || response.status === 201) {
      const json = JSON.parse(response.body || '{}') as { id?: unknown };
      if (typeof json.id !== 'string') throw new Error('Risposta di YouTube senza id del video');
      return { kind: 'done', videoId: json.id };
    }
    if (response.status === 308) {
      return {
        kind: 'incomplete',
        uploadedBytes: uploadedFromRange(header(response.headers, 'range')),
      };
    }
    if (response.status === 404) return { kind: 'expired' };
    throw parseError(response.status, response.body);
  }

  return {
    async exchangeCode(params: {
      code: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      codeVerifier?: string;
    }): Promise<GoogleTokens> {
      return tokens(
        await send(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: params.code,
            client_id: params.clientId,
            client_secret: params.clientSecret,
            redirect_uri: params.redirectUri,
            grant_type: 'authorization_code',
            ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
          }),
        }),
      );
    },

    /** Nuovo token di accesso (vale un'ora) dal refresh token. */
    async refresh(params: {
      refreshToken: string;
      clientId: string;
      clientSecret: string;
    }): Promise<GoogleTokens> {
      return tokens(
        await send(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: params.refreshToken,
            client_id: params.clientId,
            client_secret: params.clientSecret,
            grant_type: 'refresh_token',
          }),
        }),
      );
    },

    async getChannel(accessToken: string): Promise<YouTubeChannel> {
      const json = await send(`${apiUrl}/channels?part=snippet&mine=true`, {
        headers: auth(accessToken),
      });
      const item = (json.items as Array<Record<string, unknown>> | undefined)?.[0];
      if (!item || typeof item.id !== 'string') {
        throw new Error('Questo account Google non ha un canale YouTube');
      }
      const snippet = (item.snippet ?? {}) as { title?: unknown; customUrl?: unknown };
      return {
        id: item.id,
        title: typeof snippet.title === 'string' ? snippet.title : item.id,
        customUrl: typeof snippet.customUrl === 'string' ? snippet.customUrl : null,
      };
    },

    /** Apre una sessione di caricamento resumable: l'indirizzo è nell'header `Location`. */
    async createUploadSession(
      accessToken: string,
      metadata: VideoMetadata,
      sizeBytes: number,
      mime: string,
    ): Promise<string> {
      const response = await doFetch(`${uploadUrl}?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: auth(accessToken, {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(sizeBytes),
          'X-Upload-Content-Type': mime,
        }),
        body: JSON.stringify(metadata),
      });
      if (!response.ok) throw parseError(response.status, await response.text());
      const location = response.headers.get('location');
      if (!location) throw new Error('YouTube non ha restituito la sessione di caricamento');
      return location;
    },

    /** Invia i byte da `start` alla fine del file. */
    async uploadBytes(
      sessionUrl: string,
      accessToken: string,
      body: Readable,
      start: number,
      sizeBytes: number,
      mime: string,
    ): Promise<UploadOutcome> {
      const headers: Record<string, string> = auth(accessToken, {
        'Content-Length': String(sizeBytes - start),
        'Content-Type': mime,
      });
      if (start > 0) headers['Content-Range'] = `bytes ${start}-${sizeBytes - 1}/${sizeBytes}`;
      return toOutcome(await put(sessionUrl, headers, body));
    },

    /** A che punto è la sessione: un caricamento completo restituisce di nuovo il video. */
    async querySession(
      sessionUrl: string,
      accessToken: string,
      sizeBytes: number,
    ): Promise<UploadOutcome> {
      return toOutcome(
        await put(
          sessionUrl,
          auth(accessToken, { 'Content-Length': '0', 'Content-Range': `bytes */${sizeBytes}` }),
          null,
        ),
      );
    },

    /** Stato del video; null se non esiste (cancellato su YouTube). */
    async getStatus(accessToken: string, videoId: string): Promise<VideoStatus | null> {
      const json = await send(`${apiUrl}/videos?part=status&id=${encodeURIComponent(videoId)}`, {
        headers: auth(accessToken),
      });
      const item = (json.items as Array<{ status?: VideoStatus }> | undefined)?.[0];
      return item?.status ?? null;
    },

    /**
     * Sostituisce la parte `status`: i campi non inviati verrebbero azzerati, quindi si parte
     * sempre dallo stato letto con `getStatus`.
     */
    async updateStatus(accessToken: string, videoId: string, status: VideoStatus): Promise<void> {
      await send(`${apiUrl}/videos?part=status`, {
        method: 'PUT',
        headers: auth(accessToken, { 'Content-Type': 'application/json; charset=UTF-8' }),
        body: JSON.stringify({ id: videoId, status }),
      });
    },

    /** Contatori pubblici del video (Data API, 1 unità): null se il video non esiste più. */
    async videoStatistics(
      accessToken: string,
      videoId: string,
    ): Promise<{ views: number; likes: number | null; comments: number | null } | null> {
      const json = await send(
        `${apiUrl}/videos?part=statistics&id=${encodeURIComponent(videoId)}`,
        {
          headers: auth(accessToken),
        },
      );
      const stats = (json.items as Array<{ statistics?: Record<string, string> }> | undefined)?.[0]
        ?.statistics;
      if (!stats) return null;
      const num = (value: string | undefined) => (value === undefined ? null : Number(value));
      return {
        views: num(stats.viewCount) ?? 0,
        likes: num(stats.likeCount),
        comments: num(stats.commentCount),
      };
    },

    /** Iscritti del canale (YouTube li arrotonda). */
    async subscriberCount(accessToken: string): Promise<number | null> {
      const json = await send(`${apiUrl}/channels?part=statistics&mine=true`, {
        headers: auth(accessToken),
      });
      const stats = (
        json.items as
          | Array<{ statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }>
          | undefined
      )?.[0]?.statistics;
      return stats?.subscriberCount !== undefined && !stats.hiddenSubscriberCount
        ? Number(stats.subscriberCount)
        : null;
    },

    /**
     * Rapporto giornaliero del canale: visualizzazioni e iscritti guadagnati/persi. Gli ultimi
     * giorni mancano finché YouTube non ha tutti i dati.
     */
    async channelDailyReport(
      accessToken: string,
      startDate: string,
      endDate: string,
    ): Promise<Array<{ day: string; views: number; gained: number; lost: number }>> {
      const url = new URL(analyticsUrl);
      url.searchParams.set('ids', 'channel==MINE');
      url.searchParams.set('startDate', startDate);
      url.searchParams.set('endDate', endDate);
      url.searchParams.set('metrics', 'views,subscribersGained,subscribersLost');
      url.searchParams.set('dimensions', 'day');
      url.searchParams.set('sort', 'day');
      const json = await send(url.toString(), { headers: auth(accessToken) });
      const headers = ((json.columnHeaders as Array<{ name?: string }> | undefined) ?? []).map(
        (h) => h.name,
      );
      const index = (name: string) => headers.indexOf(name);
      return ((json.rows as unknown[][] | undefined) ?? []).map((row) => ({
        day: String(row[index('day')]),
        views: Number(row[index('views')] ?? 0),
        gained: Number(row[index('subscribersGained')] ?? 0),
        lost: Number(row[index('subscribersLost')] ?? 0),
      }));
    },

    /** Cancella il video; se non esiste più non è un errore. */
    async deleteVideo(accessToken: string, videoId: string): Promise<void> {
      const response = await doFetch(`${apiUrl}/videos?id=${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
        headers: auth(accessToken),
      });
      if (response.ok || response.status === 404) return;
      throw parseError(response.status, await response.text());
    },
  };
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>;

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
