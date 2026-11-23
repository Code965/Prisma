import type { BlogConnection, SocialAccount } from '@prisma-app/shared';
import { and, eq } from 'drizzle-orm';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { socialAccounts } from '../../db/schema.js';
import { BusinessRuleError, NotConfiguredError, NotFoundError } from '../../http/error-handler.js';
import {
  BlogHttpError,
  isNotConfigured,
  normalizeBlogBaseUrl,
  type BlogClient,
} from '../../publishers/blog/client.js';
import type { BrandService } from '../brands/service.js';
import { upsertSocialAccount } from '../social-accounts/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';

export interface BlogConnectionConfig {
  client: BlogClient;
  cipher: TokenCipher;
}

/** Spiega in italiano perché il sito non ha accettato il collegamento. */
function connectionProblem(error: unknown): string {
  if (error instanceof BlogHttpError) {
    if (error.status === 401 || error.status === 403) return 'Il sito ha rifiutato la chiave API';
    if (isNotConfigured(error)) return 'Sul server del sito manca la chiave API';
    if (error.status === 404)
      return "All'indirizzo indicato non c'è la Blog API di Prisma (manca /health)";
    return error.message;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Sito non raggiungibile: ${detail}`;
}

/**
 * Collegamento al blog: a differenza dei social non c'è OAuth. Si salvano indirizzo dell'API del
 * sito e chiave, dopo averli verificati con `{base}/health`; la chiave è cifrata come i token.
 */
export function createBlogConnectionService(deps: {
  db: DbExecutor;
  config: BlogConnectionConfig | null;
  brands: BrandService;
  accounts: SocialAccountService;
}) {
  function requireConfig(): BlogConnectionConfig {
    if (!deps.config)
      throw new NotConfiguredError('Cifratura dei token non configurata sul server');
    return deps.config;
  }

  async function findBlogAccount(brandId: number) {
    const [row] = await deps.db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.platform, 'blog')));
    return row ?? null;
  }

  return {
    async connect(brandId: number, input: BlogConnection): Promise<SocialAccount> {
      const config = requireConfig();
      await deps.brands.ensureExists(brandId);
      const baseUrl = normalizeBlogBaseUrl(input.baseUrl);
      if (!baseUrl) {
        throw new BusinessRuleError('Indirizzo non valido: serve https (http solo per localhost)');
      }
      try {
        await config.client.health(baseUrl, input.apiKey);
      } catch (error) {
        throw new BusinessRuleError(connectionProblem(error));
      }

      // Un solo blog per brand: se l'indirizzo cambia, l'account precedente viene sostituito.
      const previous = await findBlogAccount(brandId);
      if (previous && previous.externalId !== baseUrl) {
        await deps.db
          .update(socialAccounts)
          .set({ status: 'scollegato', lastError: 'Sostituito da un nuovo indirizzo' })
          .where(eq(socialAccounts.id, previous.id));
      }

      const accountId = await upsertSocialAccount(deps.db, {
        brandId,
        platform: 'blog',
        externalId: baseUrl,
        displayName: new URL(baseUrl).host,
        handle: null,
        accessTokenEnc: config.cipher.encrypt(input.apiKey, tokenContext('blog', baseUrl)),
        refreshTokenEnc: null,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scopes: '',
      });
      return deps.accounts.get(accountId);
    },

    /** "Prova collegamento": usa la chiave salvata. */
    async test(brandId: number): Promise<{ ok: true }> {
      const config = requireConfig();
      const account = await findBlogAccount(brandId);
      if (!account || account.status === 'scollegato')
        throw new NotFoundError('Blog collegato', brandId);
      const apiKey = config.cipher.decrypt(
        account.accessTokenEnc,
        tokenContext('blog', account.externalId),
      );
      try {
        await config.client.health(account.externalId, apiKey);
      } catch (error) {
        throw new BusinessRuleError(connectionProblem(error));
      }
      return { ok: true };
    },
  };
}

export type BlogConnectionService = ReturnType<typeof createBlogConnectionService>;
