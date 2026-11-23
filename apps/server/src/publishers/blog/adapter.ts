import type { Variant } from '@prisma-app/shared';
import { articleText, wordCount } from '../../content/article-html.js';
import {
  PublishError,
  type PublishRequest,
  type PublishResult,
  type PublisherAdapter,
  type ValidationIssue,
} from '../types.js';
import { BlogHttpError, isNotConfigured, type BlogClient } from './client.js';

/** Lunghezza massima del titolo prevista dal contratto (`docs/blog-api.md`). */
export const BLOG_MAX_TITLE = 255;
const MIN_WORDS_SUGGESTED = 300;

const fmt = (n: number) => new Intl.NumberFormat('it-IT', { useGrouping: 'always' }).format(n);

/**
 * Adapter del blog personale tramite la Blog API (`docs/blog-api.md`). Per l'account:
 * `externalId` è l'indirizzo base dell'API del sito, il "token" è la sua chiave API.
 *
 * Il contratto chiede al sito di deduplicare con la chiave di idempotenza: a differenza di
 * LinkedIn, ritentare dopo un timeout o un 5xx è sicuro, perché la stessa richiesta non crea
 * mai un secondo articolo.
 */
export function createBlogAdapter(client: BlogClient): PublisherAdapter {
  return {
    platform: 'blog',

    validate(variant: Variant): ValidationIssue[] {
      const issues: ValidationIssue[] = [];
      const title = variant.metadata.title?.trim() ?? '';
      if (variant.format !== 'articolo') {
        issues.push({
          level: 'error',
          message: `Formato "${variant.format}" non valido per il blog`,
        });
      }
      if (!title) {
        issues.push({ level: 'error', message: "Manca il titolo dell'articolo" });
      } else if ([...title].length > BLOG_MAX_TITLE) {
        issues.push({ level: 'error', message: `Titolo oltre ${BLOG_MAX_TITLE} caratteri` });
      } else {
        issues.push({ level: 'ok', message: 'Titolo' });
      }

      const words = wordCount(variant.body);
      if (!articleText(variant.body)) {
        issues.push({ level: 'error', message: "Il testo dell'articolo è vuoto" });
      } else if (words < MIN_WORDS_SUGGESTED) {
        issues.push({
          level: 'warning',
          message: `Articolo di ${fmt(words)} parole: sotto le ${MIN_WORDS_SUGGESTED} consigliate`,
        });
      } else {
        issues.push({ level: 'ok', message: `Articolo di ${fmt(words)} parole` });
      }

      if (!variant.metadata.description?.trim()) {
        issues.push({ level: 'warning', message: 'Manca l’estratto (meta description)' });
      }
      return issues;
    },

    async publish(request: PublishRequest): Promise<PublishResult> {
      const { variant, account } = request;
      try {
        const article = await client.createArticle(account.externalId, account.accessToken, {
          title: variant.metadata.title?.trim() ?? '',
          html: variant.body,
          idempotencyKey: request.idempotencyKey,
          ...(variant.metadata.description?.trim()
            ? { description: variant.metadata.description.trim() }
            : {}),
          ...(variant.metadata.hashtags?.length
            ? { tags: variant.metadata.hashtags.map((tag) => tag.replace(/^#/, '')) }
            : {}),
        });
        return {
          externalId: String(article.id),
          externalUrl: article.url,
          warnings: article.duplicate
            ? ['Articolo già presente sul sito: registrato quello esistente']
            : [],
        };
      } catch (error) {
        throw classifyBlogError(error);
      }
    },
  };
}

export function classifyBlogError(error: unknown): PublishError {
  if (error instanceof BlogHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new PublishError(
        'Il sito ha rifiutato la chiave API: aggiornala nelle Impostazioni',
        false,
      );
    }
    if (isNotConfigured(error)) {
      return new PublishError('Chiave API non impostata sul server del sito', false);
    }
    if (error.status === 400 || error.status === 404 || error.status === 422) {
      return new PublishError(error.message, false);
    }
    // 429 e 5xx: la chiave di idempotenza rende sicuro il nuovo tentativo.
    return new PublishError(error.message, true);
  }
  const detail = error instanceof Error ? error.message : String(error);
  // Rete o timeout: sicuro ritentare, il sito non duplica.
  return new PublishError(`Sito non raggiungibile (${detail}), nuovo tentativo più tardi`, true);
}
