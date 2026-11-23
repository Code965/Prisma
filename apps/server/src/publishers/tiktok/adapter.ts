import { socialCaption, type Variant } from '@prisma-app/shared';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  PublishError,
  type PublisherAdapter,
  type PublishMedia,
  MetricsNotReadyError,
  type PostMetrics,
  type PublishAccount,
  type PublishRequest,
  type PublishResult,
  type ValidationIssue,
} from '../types.js';
import { TikTokHttpError, chunkPlan, type TikTokClient } from './client.js';

/** Limiti della casella (developers.tiktok.com, novembre 2026). */
export const TIKTOK_LIMITS = {
  maxBytes: 4 * 1024 * 1024 * 1024,
  /** «The longest video you can send via the Upload endpoint is 10 minutes». */
  maxDurationMs: 10 * 60_000,
  captionMax: 2200,
  mimes: ['video/mp4', 'video/quicktime', 'video/webm'],
} as const;

export const INBOX_NOTICE =
  'Inviato alla casella di TikTok: apri la notifica nell’app, incolla la didascalia e pubblica';

interface TikTokAdapterOptions {
  /** Lettura a flusso di un intervallo del video da R2; null se lo storage non è configurato. */
  openRange: ((key: string, start: number, end: number) => Promise<Readable>) | null;
  pollMs?: number;
  /** Attesa massima dell'elaborazione prima di rimandare al tentativo successivo. */
  maxWaitMs?: number;
  retryDelayMs?: number;
}

/** Stato salvato sulla pubblicazione tra un tentativo e l'altro. */
interface InboxSession {
  publishId: string;
  /** Tutti i pezzi inviati: da qui si attende solo l'elaborazione. */
  uploaded: boolean;
}

/** `publish_id` della casella (es. `v_inbox_file~v2.123`): non è l'id di un video. */
export function isPublishId(id: string): boolean {
  return id.includes('~') || /^[vp]_/.test(id);
}

function videoOf(media: readonly PublishMedia[]): PublishMedia | null {
  return media.find((m) => m.kind === 'video' && m.role === 'media') ?? null;
}

function readSession(value: string | null | undefined): InboxSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as InboxSession;
    return typeof parsed.publishId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Motivi di fallimento dell'elaborazione che un nuovo tentativo può risolvere. */
const RETRYABLE_FAIL_REASONS = new Set(['internal', 'video_pull_failed']);

function classify(error: unknown, what: string): PublishError {
  if (error instanceof PublishError) return error;
  if (error instanceof TikTokHttpError) {
    if (error.code === 'spam_risk_too_many_pending_share') {
      return new PublishError(
        'Ci sono già 5 video in attesa nella casella di TikTok: pubblicali o eliminali dall’app, poi Riprova',
        false,
      );
    }
    if (
      error.status === 401 ||
      error.code === 'access_token_invalid' ||
      error.code === 'scope_not_authorized'
    ) {
      return new PublishError(
        `${what}: accesso a TikTok scaduto o revocato, ricollega l’account`,
        false,
      );
    }
    const retryable =
      error.status === 429 || error.status >= 500 || error.code === 'rate_limit_exceeded';
    return new PublishError(`${what}: ${error.message}`, retryable);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new PublishError(`${what}: ${message}`, true);
}

/**
 * Adapter TikTok in modalità casella (scelta confermata): il video della variant va nella
 * casella dell'app come bozza; didascalia e privacy le sceglie l'autore nell'app. Senza audit
 * la pubblicazione diretta resterebbe privata e richiederebbe l'account privato.
 *
 * Una bozza non è un post: un doppione nella casella non viene pubblicato. Comunque il
 * `publish_id` si salva sulla pubblicazione e un tentativo successivo controlla prima lo stato,
 * così un esito incerto non manda un secondo video (contano tutti nel limite di 5 in attesa).
 */
export function createTikTokAdapter(
  client: TikTokClient,
  options: TikTokAdapterOptions,
): PublisherAdapter {
  const pollMs = options.pollMs ?? 5000;
  const maxWaitMs = options.maxWaitMs ?? 3 * 60_000;
  const retryDelayMs = options.retryDelayMs ?? 2000;

  function validate(variant: Variant, media: readonly PublishMedia[] = []): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (variant.format === 'carosello') {
      issues.push({
        level: 'error',
        message:
          'Caroselli TikTok non ancora supportati: le foto richiedono un dominio R2 verificato su TikTok',
      });
      return issues;
    }
    if (variant.format !== 'video') {
      issues.push({
        level: 'error',
        message: `Formato ${variant.format} non pubblicabile su TikTok`,
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
    } else if (!options.openRange) {
      issues.push({ level: 'error', message: 'Storage R2 non configurato sul server' });
    } else {
      if (!(TIKTOK_LIMITS.mimes as readonly string[]).includes(video.mime)) {
        issues.push({
          level: 'error',
          message: `Formato ${video.mime} non accettato da TikTok (MP4, MOV, WebM)`,
        });
      }
      if (video.sizeBytes > TIKTOK_LIMITS.maxBytes) {
        issues.push({ level: 'error', message: 'Video oltre 4 GB' });
      }
      if (video.durationMs !== null && video.durationMs > TIKTOK_LIMITS.maxDurationMs) {
        issues.push({
          level: 'error',
          message: 'Video oltre 10 minuti: la casella di TikTok non lo accetta',
        });
      }
      issues.push({
        level: 'ok',
        message: `Video su R2 (${Math.round(video.sizeBytes / (1024 * 1024))} MB)`,
      });
    }
    if (socialCaption(variant).length > TIKTOK_LIMITS.captionMax) {
      issues.push({
        level: 'warning',
        message: `Didascalia oltre ${TIKTOK_LIMITS.captionMax} caratteri`,
      });
    }
    issues.push({
      level: 'warning',
      message: 'Arriva nella casella di TikTok: didascalia e privacy le scegli tu nell’app',
    });
    return issues;
  }

  /** Attende che TikTok mandi la notifica (o che l'autore abbia già pubblicato). */
  async function waitForInbox(accessToken: string, publishId: string): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const { status, failReason } = await client
        .fetchStatus(accessToken, publishId)
        .catch((error) => {
          throw classify(error, 'Stato del caricamento');
        });
      if (status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE') return;
      if (status === 'FAILED') {
        const reason = failReason ?? 'motivo non indicato';
        throw new PublishError(
          `TikTok ha rifiutato il video (${reason})`,
          RETRYABLE_FAIL_REASONS.has(reason),
        );
      }
      if (Date.now() >= deadline) {
        throw new PublishError(
          'TikTok sta ancora elaborando il video: si controlla al prossimo tentativo',
          true,
        );
      }
      await sleep(pollMs);
    }
  }

  async function uploadAll(request: PublishRequest, video: PublishMedia): Promise<string> {
    const open = options.openRange!;
    const key = video.remoteKey!;
    const { accessToken } = request.account;
    const plan = chunkPlan(video.sizeBytes);
    const { publishId, uploadUrl } = await client
      .initInboxUpload(accessToken, video.sizeBytes, plan)
      .catch((error) => {
        throw classify(error, 'Avvio del caricamento');
      });
    const save = (session: InboxSession | null) =>
      request.uploadSession?.save(session ? JSON.stringify(session) : null);
    await save({ publishId, uploaded: false });
    for (const range of plan.ranges) {
      for (let attempt = 0; ; attempt++) {
        try {
          await client.uploadChunk(
            uploadUrl,
            await open(key, range[0], range[1]),
            range,
            video.sizeBytes,
            video.mime,
          );
          break;
        } catch (error) {
          const failure = classify(error, 'Caricamento del video');
          if (!failure.retryable || attempt >= 3) throw failure;
          await sleep(retryDelayMs * 2 ** attempt);
        }
      }
    }
    await save({ publishId, uploaded: true });
    return publishId;
  }

  return {
    platform: 'tiktok',
    validate,

    metrics: {
      /**
       * Il caricamento nella casella dà un `publish_id`: il post vero si conosce solo quando
       * l'autore l'ha pubblicato ed è pubblico (moderazione compresa). Da lì si usa il suo id.
       */
      async post(externalId: string, account: PublishAccount) {
        let videoId = externalId;
        let resolved: PostMetrics['resolved'];
        if (isPublishId(externalId)) {
          const { status, postIds } = await client.fetchStatus(account.accessToken, externalId);
          if (!postIds[0]) {
            throw new MetricsNotReadyError(
              status === 'PUBLISH_COMPLETE'
                ? 'Post TikTok non ancora pubblico'
                : 'Video ancora nella casella di TikTok',
            );
          }
          videoId = postIds[0];
        }
        const video = await client.queryVideo(account.accessToken, videoId);
        if (!video) throw new MetricsNotReadyError('Video TikTok non visibile: è pubblico?');
        if (videoId !== externalId) resolved = { externalId: videoId, externalUrl: video.shareUrl };
        return {
          capturedAt: new Date(),
          views: video.views ?? undefined,
          likes: video.likes ?? undefined,
          comments: video.comments ?? undefined,
          shares: video.shares ?? undefined,
          raw: video,
          resolved,
        };
      },

      async account(account: PublishAccount, _fromDay: string, toDay: string) {
        const followers = await client.followerCount(account.accessToken);
        return followers === null ? [] : [{ day: toDay, followers }];
      },
    },

    async publish(request): Promise<PublishResult> {
      const video = videoOf(request.media);
      if (!video?.remoteKey || !options.openRange)
        throw new PublishError('Video non disponibile su R2', false);
      const { accessToken } = request.account;
      const saved = readSession(request.uploadSession?.get());

      // Un tentativo precedente ha già inviato tutto: si attende l'elaborazione, non si ricarica.
      let publishId = saved?.uploaded ? saved.publishId : null;
      if (!publishId) publishId = await uploadAll(request, video);
      await waitForInbox(accessToken, publishId);
      await request.uploadSession?.save(null);
      return { externalId: publishId, externalUrl: null, warnings: [INBOX_NOTICE] };
    },
  };
}
