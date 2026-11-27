import { COMPETITOR_YOUTUBE_POSTS, type VariantFormat } from '@prisma-app/shared';
import { decodeEntities, SourceError } from '../trends/sources.js';

/**
 * Canali e video pubblici dei concorrenti dalla YouTube Data API v3 (verificata sulla doc a
 * novembre 2026): `channels.list` con `forHandle` (con o senza «@») o `id`, parti `snippet`,
 * `statistics`, `contentDetails` (playlist dei caricamenti); `playlistItems.list` sulla playlist
 * dei caricamenti (al massimo 50); `videos.list` con `snippet,statistics,contentDetails`. Ogni
 * chiamata costa 1 unità: un aggiornamento costa 3 unità su 10.000 al giorno.
 */

const API = 'https://www.googleapis.com/youtube/v3';
/** YouTube riconosce come Short i video verticali fino a 3 minuti: senza le misure è una stima. */
export const SHORT_MAX_SECONDS = 180;

export interface YouTubeChannel {
  channelId: string;
  title: string;
  handle: string | null;
  uploadsId: string;
  /** Iscritti (arrotondati da YouTube); null se il canale li nasconde. */
  subscribers: number | null;
}

export interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string | null;
  publishedAt: Date;
  durationSec: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

async function call<T>(fetchFn: typeof fetch, token: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(`${API}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SourceError('YouTube non raggiungibile');
  }
  if (response.status === 401) throw new SourceError('Ricollega l’account YouTube');
  if (response.status === 403) {
    throw new SourceError('YouTube ha rifiutato la richiesta (quota o permessi): riprova domani');
  }
  if (response.status === 404) throw new SourceError('Canale o playlist non trovati');
  if (!response.ok) throw new SourceError(`YouTube ha risposto ${response.status}`);
  return (await response.json()) as T;
}

const count = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** «PT1H2M3S» → 3723 secondi. */
export function parseDuration(value: string | undefined): number | null {
  const match = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return d! * 86_400 + h! * 3600 + m! * 60 + s!;
}

export function videoFormat(durationSec: number | null): VariantFormat {
  return durationSec !== null && durationSec > 0 && durationSec <= SHORT_MAX_SECONDS
    ? 'short'
    : 'video';
}

/** Handle («@nome», «nome», indirizzo del canale) o id «UC…» → parametro di channels.list. */
export function channelQuery(handle: string): { id: string } | { forHandle: string } {
  const value = handle.trim();
  const fromUrl = value.match(/youtube\.com\/(?:channel\/(UC[\w-]{22})|(@[\w.-]+))/i);
  if (fromUrl?.[1]) return { id: fromUrl[1] };
  if (fromUrl?.[2]) return { forHandle: fromUrl[2] };
  if (/^UC[\w-]{22}$/.test(value)) return { id: value };
  return { forHandle: value.startsWith('@') ? value : `@${value}` };
}

interface ChannelResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string };
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

export async function fetchChannel(
  fetchFn: typeof fetch,
  token: string,
  handle: string,
): Promise<YouTubeChannel> {
  const params = new URLSearchParams({
    part: 'snippet,statistics,contentDetails',
    ...channelQuery(handle),
  });
  const data = await call<ChannelResponse>(fetchFn, token, `channels?${params}`);
  const channel = data.items?.[0];
  const uploadsId = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!channel || !uploadsId) throw new SourceError(`Nessun canale YouTube «${handle}»`);
  return {
    channelId: channel.id,
    title: channel.snippet?.title ?? handle,
    handle: channel.snippet?.customUrl ?? null,
    uploadsId,
    subscribers: channel.statistics?.hiddenSubscriberCount
      ? null
      : count(channel.statistics?.subscriberCount),
  };
}

interface PlaylistResponse {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
}

interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; description?: string; publishedAt?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }>;
}

/** Ultimi video caricati con le statistiche pubbliche. */
export async function fetchRecentVideos(
  fetchFn: typeof fetch,
  token: string,
  uploadsId: string,
): Promise<YouTubeVideo[]> {
  const list = await call<PlaylistResponse>(
    fetchFn,
    token,
    `playlistItems?${new URLSearchParams({
      part: 'contentDetails',
      playlistId: uploadsId,
      maxResults: String(COMPETITOR_YOUTUBE_POSTS),
    })}`,
  );
  const ids = (list.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const videos = await call<VideosResponse>(
    fetchFn,
    token,
    `videos?${new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: ids.join(',') })}`,
  );
  return (videos.items ?? [])
    .filter((video) => video.snippet?.title && video.snippet.publishedAt)
    .map((video) => ({
      videoId: video.id,
      title: decodeEntities(video.snippet!.title!).slice(0, 200),
      description: video.snippet!.description?.trim().slice(0, 3000) || null,
      publishedAt: new Date(video.snippet!.publishedAt!),
      durationSec: parseDuration(video.contentDetails?.duration),
      views: count(video.statistics?.viewCount),
      likes: count(video.statistics?.likeCount),
      comments: count(video.statistics?.commentCount),
    }));
}
