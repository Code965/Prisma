import type { Variant } from '@prisma-app/shared';
import {
  PublishError,
  type PublishMedia,
  type PublishRequest,
  type PublishResult,
  type PublisherAdapter,
  type ValidationIssue,
} from '../types.js';
import { LinkedInHttpError, personUrn, postUrl, type LinkedInClient } from './client.js';
import { buildCommentary, visibleText } from './little-text.js';

/**
 * Lunghezza massima del testo di un post. La documentazione della Posts API non indica il numero
 * (prevede solo l'errore FIELD_LENGTH_TOO_LONG): 3.000 è il limite dell'interfaccia di LinkedIn.
 */
export const LINKEDIN_MAX_COMMENTARY = 3000;
const SUGGESTED_MAX_HASHTAGS = 5;

/**
 * Errori di rete in cui la richiesta non è mai partita: ritentare è sicuro.
 * Per tutti gli altri (timeout, connessione chiusa a metà, 5xx) LinkedIn potrebbe aver creato il
 * post: non avendo una chiave di idempotenza lato API, si chiede un controllo manuale.
 */
const SAFE_NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** Limite dei documenti indicato dalla documentazione (anche 300 pagine; un carosello ne ha al massimo 10). */
export const LINKEDIN_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export interface LinkedInAdapterOptions {
  /** Legge un file da R2 (caroselli PDF); assente se lo storage non è configurato. */
  readObject?: ((key: string) => Promise<Buffer>) | null;
  /** Attesa tra un controllo e l'altro dello stato del documento. */
  documentPollMs?: number;
  /** Oltre questo tempo il documento ancora in elaborazione fa ritentare più tardi. */
  documentTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Il PDF del carosello tra i file della variant. */
function carouselPdf(media: readonly PublishMedia[]): PublishMedia | undefined {
  return media.find((m) => m.role === 'media' && m.kind === 'pdf');
}

export function createLinkedInAdapter(
  client: LinkedInClient,
  options: LinkedInAdapterOptions = {},
): PublisherAdapter {
  const readObject = options.readObject ?? null;
  const pollMs = options.documentPollMs ?? 2000;
  const timeoutMs = options.documentTimeoutMs ?? 60_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  function carouselIssues(media: readonly PublishMedia[]): ValidationIssue[] {
    const error = (message: string): ValidationIssue[] => [{ level: 'error', message }];
    if (!readObject) return error('Storage R2 non configurato sul server: serve per i caroselli');
    const pdf = carouselPdf(media);
    if (!pdf) return error('Manca il PDF del carosello: esportalo dall’editor carosello');
    if (!pdf.upToDate) return error('Il PDF non corrisponde più alle slide: esportalo di nuovo');
    if (!pdf.remoteKey) {
      return error('Il PDF non è ancora caricato su R2: caricalo dall’editor carosello');
    }
    if (pdf.sizeBytes > LINKEDIN_MAX_DOCUMENT_BYTES) {
      return error('Il PDF supera i 100 MB ammessi da LinkedIn');
    }
    return [{ level: 'ok', message: 'Carosello PDF caricato' }];
  }

  /**
   * Prepara il documento: inizializza, carica i byte e attende che LinkedIn lo elabori. Nessun
   * post esiste ancora, quindi gli errori temporanei si possono ritentare senza rischi.
   */
  async function prepareDocument(
    accessToken: string,
    owner: string,
    bytes: Uint8Array,
  ): Promise<string> {
    try {
      const { uploadUrl, document } = await client.initializeDocumentUpload(accessToken, owner);
      await client.uploadDocument(accessToken, uploadUrl, bytes);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = await client.documentStatus(accessToken, document);
        if (status === 'AVAILABLE') return document;
        if (status === 'PROCESSING_FAILED') {
          throw new PublishError('LinkedIn non è riuscito a elaborare il PDF del carosello', false);
        }
        if (Date.now() >= deadline) {
          throw new PublishError(
            'LinkedIn sta ancora elaborando il PDF: nuovo tentativo più tardi',
            true,
          );
        }
        await sleep(pollMs);
      }
    } catch (error) {
      throw classifyPreparationError(error);
    }
  }

  return {
    platform: 'linkedin',

    validate(variant: Variant, media: readonly PublishMedia[] = []): ValidationIssue[] {
      const issues: ValidationIssue[] = [];
      if (variant.format === 'post') {
        issues.push({ level: 'ok', message: 'Post di testo' });
      } else if (variant.format === 'carosello') {
        issues.push(...carouselIssues(media));
      } else {
        issues.push({
          level: 'error',
          message: `Formato "${variant.format}" non ancora supportato su LinkedIn: solo post e caroselli`,
        });
      }
      if (!variant.body.trim()) {
        issues.push({ level: 'error', message: 'Il testo del post è vuoto' });
      }
      const length = [...visibleText(variant.body, variant.metadata.hashtags)].length;
      const lengthLabel = `${formatThousands(length)} / ${formatThousands(LINKEDIN_MAX_COMMENTARY)}`;
      if (length > LINKEDIN_MAX_COMMENTARY) {
        issues.push({
          level: 'error',
          message: `Testo di ${length} caratteri: LinkedIn ne accetta al massimo ${LINKEDIN_MAX_COMMENTARY}`,
        });
      } else if (variant.body.trim()) {
        issues.push({ level: 'ok', message: `Testo ${lengthLabel}` });
      }
      if (variant.metadata.firstComment?.trim()) {
        issues.push({ level: 'ok', message: 'Primo commento pronto' });
      }
      if (/https?:\/\//i.test(variant.body)) {
        issues.push({
          level: 'warning',
          message: 'Link nel testo: di solito conviene metterlo nel primo commento',
        });
      }
      if (variant.metadata.hashtags.length > SUGGESTED_MAX_HASHTAGS) {
        issues.push({
          level: 'warning',
          message: `${variant.metadata.hashtags.length} hashtag: su LinkedIn ne bastano 3-5`,
        });
      }
      return issues;
    },

    async publish(request: PublishRequest): Promise<PublishResult> {
      const { variant, account } = request;
      const author = personUrn(account.externalId);
      const commentary = buildCommentary(variant.body, variant.metadata.hashtags);

      let media: { id: string; title: string } | undefined;
      if (variant.format === 'carosello') {
        const pdf = carouselPdf(request.media);
        if (!readObject || !pdf?.remoteKey || !pdf.upToDate) {
          throw new PublishError(carouselIssues(request.media)[0]!.message, false);
        }
        let bytes: Buffer;
        try {
          bytes = await readObject(pdf.remoteKey);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new PublishError(
            `PDF non leggibile da R2 (${detail}): nuovo tentativo più tardi`,
            true,
          );
        }
        const document = await prepareDocument(account.accessToken, author, bytes);
        media = { id: document, title: documentTitle(variant) };
      }

      let postUrn: string;
      try {
        postUrn = await client.createPost(account.accessToken, author, commentary, media);
      } catch (error) {
        throw classifyPostError(error);
      }

      // Il post è online: un problema col primo commento non deve farlo risultare fallito.
      const warnings: string[] = [];
      const firstComment = variant.metadata.firstComment?.trim();
      if (firstComment) {
        try {
          await client.createComment(account.accessToken, author, postUrn, firstComment);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          warnings.push(`Post pubblicato, ma il primo commento non è stato aggiunto: ${detail}`);
        }
      }

      return { externalId: postUrn, externalUrl: postUrl(postUrn), warnings };
    },
  };
}

/** Titolo del documento mostrato da LinkedIn: il titolo della copertina del carosello. */
export function documentTitle(variant: Variant): string {
  const cover = variant.metadata.carousel?.slides[0]?.title.trim();
  return (cover || variant.metadata.title || 'Carosello').slice(0, 200);
}

/**
 * Errori prima della creazione del post: nulla è stato pubblicato, quindi rete, 429 e 5xx si
 * ritentano; permessi mancanti e richieste rifiutate no.
 */
export function classifyPreparationError(error: unknown): PublishError {
  if (error instanceof PublishError) return error;
  if (error instanceof LinkedInHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new PublishError(
        `LinkedIn ha rifiutato il caricamento del PDF (${error.status}): ricollega l'account`,
        false,
      );
    }
    if (error.status === 429 || error.status >= 500) {
      return new PublishError(
        `Caricamento del PDF su LinkedIn non riuscito (${error.status}): nuovo tentativo più tardi`,
        true,
      );
    }
    return new PublishError(`LinkedIn ha rifiutato il PDF: ${error.message}`, false);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new PublishError(
    `Caricamento del PDF non riuscito (${detail}): nuovo tentativo più tardi`,
    true,
  );
}

function formatThousands(value: number): string {
  return new Intl.NumberFormat('it-IT', { useGrouping: 'always' }).format(value);
}

export function classifyPostError(error: unknown): PublishError {
  if (error instanceof LinkedInHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new PublishError(
        `LinkedIn ha rifiutato l'autorizzazione (${error.status}): ricollega l'account`,
        false,
      );
    }
    if (error.status === 429) {
      return new PublishError(
        'Limite di richieste LinkedIn raggiunto, nuovo tentativo più tardi',
        true,
      );
    }
    if (error.status >= 500) {
      return new PublishError(
        `Esito incerto (LinkedIn ${error.status}): controlla il profilo prima di usare Riprova`,
        false,
      );
    }
    return new PublishError(error.message, false);
  }

  const code = (error as { cause?: { code?: string } })?.cause?.code;
  if (code && SAFE_NETWORK_CODES.has(code)) {
    return new PublishError(
      `LinkedIn non raggiungibile (${code}), nuovo tentativo più tardi`,
      true,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new PublishError(
    `Esito incerto (${detail}): controlla il profilo prima di usare Riprova`,
    false,
  );
}
