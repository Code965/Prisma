import type { Variant } from '@prisma-app/shared';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  PublishError,
  type AccountDayMetrics,
  type PublishAccount,
  type PublisherAdapter,
  type PublishMedia,
  type PublishRequest,
  type PublishResult,
  type ValidationIssue,
} from '../types.js';
import {
  GoogleHttpError,
  videoUrl,
  type UploadOutcome,
  type VideoMetadata,
  type YouTubeClient,
} from './client.js';

/** Limiti di `videos.insert` (developers.google.com/youtube/v3/docs/videos, novembre 2026). */
export const YOUTUBE_LIMITS = {
  titleMax: 100,
  descriptionMaxBytes: 5000,
  tagsMaxChars: 500,
} as const;

/** Si carica in anticipo solo se mancano almeno 15 minuti: `publishAt` deve essere nel futuro. */
export const YOUTUBE_MIN_LEAD_MS = 15 * 60_000;
/** Durata oltre la quale un video verticale non viene più trattato come Short (da riverificare). */
const SHORT_MAX_MS = 180_000;
const RESUME_ATTEMPTS = 3;

interface YouTubeAdapterOptions {
  /** Lettura a flusso del video da R2; null se lo storage non è configurato. */
  openObject: ((key: string, start: number) => Promise<Readable>) | null;
  /** Categoria del video (28 = Scienza e tecnologia). */
  categoryId?: string;
  retryDelayMs?: number;
}

function videoOf(media: readonly PublishMedia[]): PublishMedia | null {
  return media.find((m) => m.kind === 'video' && m.role === 'media') ?? null;
}

function tagsOf(variant: Variant): string[] {
  return variant.metadata.hashtags.map((tag) => tag.replace(/^#/, ''));
}

/** Descrizione: il campo dedicato (o il testo della variant) con gli hashtag in fondo. */
export function descriptionOf(variant: Variant): string {
  const text = (variant.metadata.description ?? variant.body).trim();
  const tags = variant.metadata.hashtags.join(' ');
  return tags ? `${text}\n\n${tags}` : text;
}

function tagsLength(tags: readonly string[]): number {
  // Le virgole contano; un tag con spazi conta come racchiuso tra virgolette.
  return tags.reduce((n, tag, i) => n + tag.length + (/\s/.test(tag) ? 2 : 0) + (i > 0 ? 1 : 0), 0);
}

export function metadataOf(
  variant: Variant,
  privacy: VideoMetadata['status'],
  categoryId: string,
): VideoMetadata {
  const tags = tagsOf(variant);
  return {
    snippet: {
      title: (variant.metadata.title ?? '').trim(),
      description: descriptionOf(variant),
      ...(tags.length ? { tags } : {}),
      categoryId,
      defaultLanguage: 'it',
    },
    status: privacy,
  };
}

/** Errori di Google → errori di pubblicazione: si ritentano rete, 429 e 5xx. */
function classify(error: unknown, what: string): PublishError {
  if (error instanceof PublishError) return error;
  if (error instanceof GoogleHttpError) {
    if (error.status === 401 || error.reason === 'invalid_grant') {
      return new PublishError(
        `${what}: accesso a YouTube scaduto o revocato, ricollega l’account`,
        false,
      );
    }
    if (error.reason === 'quotaExceeded' || error.reason === 'uploadLimitExceeded') {
      return new PublishError(
        `${what}: limite giornaliero di YouTube raggiunto (${error.reason})`,
        false,
      );
    }
    const retryable = error.status === 429 || error.status >= 500;
    return new PublishError(`${what}: ${error.message}`, retryable);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new PublishError(`${what}: ${message}`, true);
}

/**
 * Adapter YouTube: caricamento resumable del video della variant (da R2), uscita programmata
 * con `publishAt` quando c'è tempo, altrimenti pubblico subito.
 *
 * «Mai due volte»: `videos.insert` non ha chiavi di idempotenza, ma la sessione resumable
 * è salvata sulla pubblicazione prima di inviare i byte. Un tentativo interrotto chiede a
 * YouTube a che punto è (un caricamento completo restituisce di nuovo il video) e riprende da lì.
 */
export function createYouTubeAdapter(
  client: YouTubeClient,
  options: YouTubeAdapterOptions,
): PublisherAdapter {
  const categoryId = options.categoryId ?? '28';
  const retryDelayMs = options.retryDelayMs ?? 2000;

  function validate(variant: Variant, media: readonly PublishMedia[] = []): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (variant.format !== 'video' && variant.format !== 'short') {
      issues.push({
        level: 'error',
        message: `Formato ${variant.format} non pubblicabile su YouTube`,
      });
    }
    const title = (variant.metadata.title ?? '').trim();
    if (!title) issues.push({ level: 'error', message: 'Manca il titolo del video' });
    else if ([...title].length > YOUTUBE_LIMITS.titleMax) {
      issues.push({ level: 'error', message: `Titolo oltre ${YOUTUBE_LIMITS.titleMax} caratteri` });
    }
    const description = descriptionOf(variant);
    if (/[<>]/.test(title) || /[<>]/.test(description)) {
      issues.push({ level: 'error', message: 'Titolo e descrizione non possono contenere < o >' });
    }
    const bytes = Buffer.byteLength(description, 'utf8');
    if (bytes > YOUTUBE_LIMITS.descriptionMaxBytes) {
      issues.push({
        level: 'error',
        message: `Descrizione (con gli hashtag) di ${bytes} byte: il massimo è ${YOUTUBE_LIMITS.descriptionMaxBytes}`,
      });
    }
    if (tagsLength(tagsOf(variant)) > YOUTUBE_LIMITS.tagsMaxChars) {
      issues.push({
        level: 'error',
        message: `Tag oltre ${YOUTUBE_LIMITS.tagsMaxChars} caratteri in tutto`,
      });
    }
    const video = videoOf(media);
    if (!video) {
      issues.push({
        level: 'error',
        message: 'Nessun video collegato: esportalo dall’editor video',
      });
    } else if (!video.remoteKey) {
      issues.push({ level: 'error', message: 'Il video non è ancora caricato su R2' });
    } else if (!options.openObject) {
      issues.push({ level: 'error', message: 'Storage R2 non configurato sul server' });
    } else {
      const size = `${Math.round(video.sizeBytes / (1024 * 1024))} MB`;
      issues.push({ level: 'ok', message: `Video su R2 (${size})` });
      const vertical = video.width !== null && video.height !== null && video.height > video.width;
      if (variant.format === 'short' && !vertical) {
        issues.push({ level: 'warning', message: 'Per uno Short serve un video verticale' });
      }
      if (
        variant.format === 'short' &&
        video.durationMs !== null &&
        video.durationMs > SHORT_MAX_MS
      ) {
        issues.push({
          level: 'warning',
          message: 'Video oltre 3 minuti: YouTube potrebbe non trattarlo come Short',
        });
      }
    }
    if (variant.metadata.firstComment) {
      issues.push({
        level: 'warning',
        message: 'Il commento fissato non viene pubblicato in automatico',
      });
    }
    return issues;
  }

  /** Carica il video (riprendendo una sessione salvata) e restituisce l'id. */
  async function upload(
    request: PublishRequest,
    privacy: VideoMetadata['status'],
  ): Promise<string> {
    const video = videoOf(request.media);
    if (!video?.remoteKey || !options.openObject) {
      throw new PublishError('Video non disponibile su R2', false);
    }
    const { accessToken } = request.account;
    const key = video.remoteKey;
    const open = options.openObject;
    const send = (session: string, start: number): Promise<UploadOutcome> =>
      open(key, start).then((body) =>
        client.uploadBytes(session, accessToken, body, start, video.sizeBytes, video.mime),
      );

    let session = request.uploadSession?.get() ?? null;
    let outcome: UploadOutcome | null = null;
    if (session) {
      outcome = await client.querySession(session, accessToken, video.sizeBytes).catch((error) => {
        throw classify(error, 'Ripresa del caricamento');
      });
      if (outcome.kind === 'expired') session = null;
    }
    if (!session) {
      session = await client
        .createUploadSession(
          accessToken,
          metadataOf(request.variant, privacy, categoryId),
          video.sizeBytes,
          video.mime,
        )
        .catch((error) => {
          throw classify(error, 'Avvio del caricamento');
        });
      await request.uploadSession?.save(session);
      outcome = { kind: 'incomplete', uploadedBytes: 0 };
    }

    for (let attempt = 0; ; attempt++) {
      if (outcome?.kind === 'done') break;
      if (outcome?.kind === 'expired') {
        await request.uploadSession?.save(null);
        throw new PublishError(
          'Sessione di caricamento scaduta: si riparte al prossimo tentativo',
          true,
        );
      }
      const start = outcome?.uploadedBytes ?? 0;
      try {
        outcome = await send(session, start);
      } catch (error) {
        const failure = classify(error, 'Caricamento del video');
        if (!failure.retryable || attempt >= RESUME_ATTEMPTS) throw failure;
        await sleep(retryDelayMs * 2 ** attempt);
        // Dopo un errore si chiede a YouTube quanti byte ha ricevuto.
        outcome = await client.querySession(session, accessToken, video.sizeBytes).catch((e) => {
          throw classify(e, 'Ripresa del caricamento');
        });
      }
    }
    await request.uploadSession?.save(null);
    return outcome.videoId;
  }

  async function finalize(
    request: PublishRequest & { externalId: string },
  ): Promise<PublishResult> {
    const { accessToken } = request.account;
    try {
      const status = await client.getStatus(accessToken, request.externalId);
      if (!status) {
        throw new PublishError(
          'Il video non esiste più su YouTube: annulla e programma di nuovo',
          false,
        );
      }
      if (status.privacyStatus !== 'public') {
        // `publishAt` si toglie: vale solo per i video privati.
        const rest = { ...status };
        delete rest.publishAt;
        await client.updateStatus(accessToken, request.externalId, {
          ...rest,
          privacyStatus: 'public',
        });
      }
      return { externalId: request.externalId, externalUrl: videoUrl(request.externalId) };
    } catch (error) {
      throw classify(error, 'Pubblicazione del video caricato');
    }
  }

  return {
    platform: 'youtube',
    validate,

    metrics: {
      async post(externalId: string, account: PublishAccount) {
        const stats = await client.videoStatistics(account.accessToken, externalId);
        if (!stats) throw new Error('Il video non esiste più su YouTube');
        return {
          capturedAt: new Date(),
          views: stats.views,
          likes: stats.likes ?? undefined,
          comments: stats.comments ?? undefined,
          raw: stats,
        };
      },

      async account(account: PublishAccount, fromDay: string, toDay: string) {
        const [rows, subscribers] = await Promise.all([
          client.channelDailyReport(account.accessToken, fromDay, toDay),
          client.subscriberCount(account.accessToken),
        ]);
        const days = new Map<string, AccountDayMetrics>(
          rows.map((row) => [
            row.day,
            {
              day: row.day,
              views: row.views,
              followersGained: row.gained,
              followersLost: row.lost,
            },
          ]),
        );
        if (subscribers !== null) {
          days.set(toDay, { ...days.get(toDay), day: toDay, followers: subscribers });
        }
        return [...days.values()].sort((x, y) => x.day.localeCompare(y.day));
      },
    },

    async publish(request) {
      const id = await upload(request, { privacyStatus: 'public', selfDeclaredMadeForKids: false });
      return { externalId: id, externalUrl: videoUrl(id) };
    },

    advance: {
      minLeadMs: YOUTUBE_MIN_LEAD_MS,

      async prepare(request) {
        const id = await upload(request, {
          privacyStatus: 'private',
          publishAt: request.scheduledAt.toISOString(),
          selfDeclaredMadeForKids: false,
        });
        return { externalId: id, externalUrl: videoUrl(id) };
      },

      finalize,

      async withdraw(account: PublishAccount, externalId: string) {
        try {
          await client.deleteVideo(account.accessToken, externalId);
        } catch (error) {
          throw classify(error, 'Cancellazione del video da YouTube');
        }
      },

      async reschedule(account: PublishAccount, externalId: string, scheduledAt: Date) {
        try {
          const status = await client.getStatus(account.accessToken, externalId);
          if (!status) throw new PublishError('Il video non esiste più su YouTube', false);
          if (status.privacyStatus === 'public') {
            throw new PublishError(
              'Il video è già pubblico su YouTube: non si può spostare',
              false,
            );
          }
          await client.updateStatus(account.accessToken, externalId, {
            ...status,
            privacyStatus: 'private',
            publishAt: scheduledAt.toISOString(),
          });
        } catch (error) {
          throw classify(error, 'Spostamento dell’uscita su YouTube');
        }
      },
    },
  };
}
