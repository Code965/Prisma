import type { Variant } from '@prisma-app/shared';
import {
  PublishError,
  type PublishMedia,
  type AccountDayMetrics,
  type PublishRequest,
  type PublishResult,
  type PublisherAdapter,
  type ValidationIssue,
} from '../types.js';
import { InstagramHttpError, type InstagramClient } from './client.js';

/** Limiti della didascalia (parametro `caption`): 2.200 caratteri, 30 hashtag, 20 menzioni. */
export const INSTAGRAM_MAX_CAPTION = 2200;
export const INSTAGRAM_MAX_HASHTAGS = 30;
export const INSTAGRAM_MAX_MENTIONS = 20;
/** La documentazione ammette fino a 20 elementi; l'editor di Prisma si ferma a 10 slide. */
export const INSTAGRAM_MAX_CAROUSEL_ITEMS = 20;
export const INSTAGRAM_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SAFE_NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

export interface InstagramAdapterOptions {
  /** Attesa tra due controlli dello stato dei container. */
  containerPollMs?: number;
  /** Oltre questo tempo un container ancora in lavorazione fa ritentare più tardi. */
  containerTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Didascalia: testo e hashtag in coda, come li scrive chi pubblica a mano. */
export function buildCaption(body: string, hashtags: readonly string[]): string {
  return [body.trim(), hashtags.join(' ')].filter(Boolean).join('\n\n');
}

/** Le immagini delle slide, nell'ordine del carosello. */
function slideImages(media: readonly PublishMedia[]): PublishMedia[] {
  return media
    .filter((m) => m.role === 'media' && m.kind === 'image')
    .sort((a, b) => a.position - b.position);
}

const DAY_MS = 24 * 60 * 60_000;

export function createInstagramAdapter(
  client: InstagramClient,
  options: InstagramAdapterOptions = {},
): PublisherAdapter {
  const pollMs = options.containerPollMs ?? 3000;
  const timeoutMs = options.containerTimeoutMs ?? 90_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  function mediaIssues(variant: Variant, media: readonly PublishMedia[]): ValidationIssue[] {
    const error = (message: string): ValidationIssue[] => [{ level: 'error', message }];
    const slides = variant.metadata.carousel?.slides.length ?? 0;
    if (slides === 0)
      return error('Su Instagram serve almeno un’immagine: crea le slide nell’editor carosello');
    const images = slideImages(media);
    if (images.length === 0) return error('Mancano le immagini: esporta il carosello in JPG');
    if (images.length !== slides || images.some((i) => !i.upToDate)) {
      return error('Le immagini non corrispondono più alle slide: esporta di nuovo');
    }
    if (images.some((i) => i.mime !== 'image/jpeg'))
      return error('Instagram accetta solo immagini JPEG');
    if (images.some((i) => i.sizeBytes > INSTAGRAM_MAX_IMAGE_BYTES)) {
      return error('Un’immagine supera gli 8 MB ammessi da Instagram');
    }
    if (images.some((i) => !i.remoteKey)) {
      return error('Le immagini non sono ancora caricate su R2: caricale dall’editor carosello');
    }
    if (images.some((i) => !i.remoteUrl)) {
      return error(
        'Il bucket R2 non ha un indirizzo pubblico (R2_PUBLIC_BASE_URL): Instagram non può scaricare le immagini',
      );
    }
    if (images.length > INSTAGRAM_MAX_CAROUSEL_ITEMS) {
      return error(
        `Instagram ammette al massimo ${INSTAGRAM_MAX_CAROUSEL_ITEMS} elementi per carosello`,
      );
    }
    const label =
      images.length === 1 ? 'Immagine singola' : `Carosello di ${images.length} immagini`;
    return [{ level: 'ok', message: `${label} JPEG, caricata su R2` }];
  }

  function captionIssues(variant: Variant): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const caption = buildCaption(variant.body, variant.metadata.hashtags);
    const length = [...caption].length;
    const hashtags = (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
    const mentions = (caption.match(/(^|\s)@[\w.]+/g) ?? []).length;
    if (length > INSTAGRAM_MAX_CAPTION) {
      issues.push({
        level: 'error',
        message: `Didascalia di ${length} caratteri: il massimo è ${INSTAGRAM_MAX_CAPTION}`,
      });
    }
    if (hashtags > INSTAGRAM_MAX_HASHTAGS) {
      issues.push({
        level: 'error',
        message: `${hashtags} hashtag: Instagram ne accetta al massimo ${INSTAGRAM_MAX_HASHTAGS}`,
      });
    }
    if (mentions > INSTAGRAM_MAX_MENTIONS) {
      issues.push({
        level: 'error',
        message: `${mentions} menzioni: il massimo è ${INSTAGRAM_MAX_MENTIONS}`,
      });
    }
    if (issues.length === 0) {
      issues.push({ level: 'ok', message: `Didascalia ${length} / ${INSTAGRAM_MAX_CAPTION}` });
    }
    if (/https?:\/\//i.test(variant.body)) {
      issues.push({
        level: 'warning',
        message: 'I link nella didascalia di Instagram non sono cliccabili',
      });
    }
    return issues;
  }

  /** Attende che il container sia pronto. Nulla è ancora pubblicato: i problemi temporanei si ritentano. */
  async function waitFinished(accessToken: string, containerId: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await client.containerStatus(accessToken, containerId);
      if (status === 'FINISHED') return;
      if (status === 'ERROR')
        throw new PublishError('Instagram non è riuscito a preparare l’immagine', false);
      if (status === 'EXPIRED' || status === 'PUBLISHED') {
        throw new PublishError(
          `Container Instagram in stato ${status}: nuovo tentativo più tardi`,
          true,
        );
      }
      if (Date.now() >= deadline) {
        throw new PublishError(
          'Instagram sta ancora preparando le immagini: nuovo tentativo più tardi',
          true,
        );
      }
      await sleep(pollMs);
    }
  }

  /** Quota, container ed elaborazione: tutto prima della pubblicazione vera e propria. */
  async function prepare(request: PublishRequest): Promise<string> {
    const { variant, account } = request;
    const token = account.accessToken;
    const igId = account.externalId;
    const caption = buildCaption(variant.body, variant.metadata.hashtags);
    const images = slideImages(request.media);
    try {
      const quota = await client.publishingQuota(token, igId);
      if (quota.usage >= quota.total) {
        throw new PublishError(
          `Limite di ${quota.total} post in 24 ore raggiunto su Instagram: nuovo tentativo più tardi`,
          true,
        );
      }
      if (images.length === 1) {
        const id = await client.createImageContainer(token, igId, {
          imageUrl: images[0]!.remoteUrl!,
          caption,
        });
        await waitFinished(token, id);
        return id;
      }
      const children: string[] = [];
      for (const image of images) {
        children.push(
          await client.createImageContainer(token, igId, {
            imageUrl: image.remoteUrl!,
            carouselItem: true,
          }),
        );
      }
      for (const child of children) await waitFinished(token, child);
      const carousel = await client.createCarouselContainer(token, igId, children, caption);
      await waitFinished(token, carousel);
      return carousel;
    } catch (error) {
      throw classifyPreparationError(error);
    }
  }

  function validate(variant: Variant, media: readonly PublishMedia[] = []): ValidationIssue[] {
    if (variant.format !== 'carosello' && variant.format !== 'post') {
      return [
        {
          level: 'error',
          message: `Formato "${variant.format}" non ancora supportato su Instagram: solo immagini e caroselli`,
        },
      ];
    }
    return [...mediaIssues(variant, media), ...captionIssues(variant)];
  }

  return {
    platform: 'instagram',
    validate,
    metrics: {
      async post(externalId, account) {
        const values = await client.mediaInsights(account.accessToken, externalId);
        return {
          capturedAt: new Date(),
          reach: values.reach ?? undefined,
          views: values.views ?? undefined,
          likes: values.likes ?? undefined,
          comments: values.comments ?? undefined,
          shares: values.shares ?? undefined,
          saves: values.saved ?? undefined,
          raw: values,
        };
      },

      async account(account, fromDay, toDay) {
        const since = new Date(`${fromDay}T00:00:00Z`);
        const until = new Date(new Date(`${toDay}T00:00:00Z`).getTime() + DAY_MS);
        const [reach, followers] = await Promise.all([
          client.accountReach(account.accessToken, account.externalId, since, until),
          client.followersCount(account.accessToken, account.externalId),
        ]);
        const days = new Map<string, AccountDayMetrics>();
        for (const point of reach) {
          // `end_time` è la mezzanotte (ora dell'account, in UTC) che chiude il giorno: 12 ore prima
          // si è a metà di quel giorno, qualunque sia il fuso.
          const day = new Date(new Date(point.endTime).getTime() - 12 * 60 * 60_000)
            .toISOString()
            .slice(0, 10);
          if (day >= fromDay && day <= toDay) days.set(day, { day, reach: point.value });
        }
        if (followers !== null) days.set(toDay, { ...days.get(toDay), day: toDay, followers });
        return [...days.values()].sort((x, y) => x.day.localeCompare(y.day));
      },
    },

    async publish(request: PublishRequest): Promise<PublishResult> {
      const blocking = validate(request.variant, request.media).find((i) => i.level === 'error');
      if (blocking) throw new PublishError(blocking.message, false);

      const creationId = await prepare(request);
      const token = request.account.accessToken;
      let published: { mediaId: string; configIssue: string | null };
      try {
        published = await client.publish(token, request.account.externalId, creationId);
      } catch (error) {
        throw classifyPublishError(error);
      }

      // Il post è online: link e avvisi non devono farlo risultare fallito.
      const warnings: string[] = [];
      if (published.configIssue) {
        warnings.push(`Post pubblicato con un avviso di Instagram: ${published.configIssue}`);
      }
      let url: string | null = null;
      try {
        url = await client.permalink(token, published.mediaId);
      } catch {
        warnings.push('Post pubblicato, ma Instagram non ha restituito il link');
      }
      return { externalId: published.mediaId, externalUrl: url, warnings };
    },
  };
}

function networkCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } })?.cause?.code;
}

/** Prima di `media_publish` nulla è online: rete, 429 e 5xx si ritentano. */
export function classifyPreparationError(error: unknown): PublishError {
  if (error instanceof PublishError) return error;
  if (error instanceof InstagramHttpError) {
    if (error.status === 401 || error.code === 190) {
      return new PublishError('Instagram ha rifiutato il token: ricollega l’account', false);
    }
    if (error.status === 429 || error.status >= 500) {
      return new PublishError(
        `Instagram non disponibile (${error.status}): nuovo tentativo più tardi`,
        true,
      );
    }
    return new PublishError(`Instagram ha rifiutato il contenuto: ${error.message}`, false);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new PublishError(
    `Instagram non raggiungibile (${detail}): nuovo tentativo più tardi`,
    true,
  );
}

/**
 * `media_publish` non ha chiavi di idempotenza: se la risposta si perde il post potrebbe essere
 * online. Si ritentano solo i rifiuti certi (429, rete prima dell'invio); il resto chiede un
 * controllo a mano.
 */
export function classifyPublishError(error: unknown): PublishError {
  if (error instanceof InstagramHttpError) {
    if (error.status === 401 || error.code === 190) {
      return new PublishError('Instagram ha rifiutato il token: ricollega l’account', false);
    }
    if (error.status === 429) {
      return new PublishError(
        'Limite di richieste Instagram raggiunto, nuovo tentativo più tardi',
        true,
      );
    }
    if (error.status >= 500) {
      return new PublishError(
        `Esito incerto (Instagram ${error.status}): controlla il profilo prima di usare Riprova`,
        false,
      );
    }
    return new PublishError(`Instagram ha rifiutato la pubblicazione: ${error.message}`, false);
  }
  const code = networkCode(error);
  if (code && SAFE_NETWORK_CODES.has(code)) {
    return new PublishError(
      `Instagram non raggiungibile (${code}), nuovo tentativo più tardi`,
      true,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new PublishError(
    `Esito incerto (${detail}): controlla il profilo prima di usare Riprova`,
    false,
  );
}
