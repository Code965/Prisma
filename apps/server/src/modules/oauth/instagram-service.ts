import type { SocialAccount } from '@prisma-app/shared';
import { and, eq, lt } from 'drizzle-orm';
import { createOAuthState, verifyOAuthState } from '../../auth/oauth-state.js';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { socialAccounts } from '../../db/schema.js';
import { NotConfiguredError } from '../../http/error-handler.js';
import {
  INSTAGRAM_SCOPES,
  authorizationUrl,
  type InstagramClient,
} from '../../publishers/instagram/client.js';
import type { BrandService } from '../brands/service.js';
import { upsertSocialAccount } from '../social-accounts/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';
import { OAuthDeniedError } from './linkedin-service.js';

export interface InstagramOAuthConfig {
  client: InstagramClient;
  appId: string;
  appSecret: string;
  redirectUri: string;
  cipher: TokenCipher;
  stateSecret: Buffer;
}

const DAY_MS = 24 * 60 * 60_000;
/** Si rinnovano i token che scadono entro questo margine (valgono 60 giorni). */
export const REFRESH_WITHIN_MS = 20 * DAY_MS;
/** Instagram rinnova solo token con almeno 24 ore di vita. */
const MIN_TOKEN_AGE_MS = DAY_MS;

/**
 * Collegamento di un account Instagram professionale (Business Login for Instagram): codice →
 * token di un'ora → token di 60 giorni, rinnovato in automatico prima della scadenza.
 */
export function createInstagramOAuthService(deps: {
  db: DbExecutor;
  config: InstagramOAuthConfig | null;
  brands: BrandService;
  accounts: SocialAccountService;
  now: () => Date;
}) {
  function requireConfig(): InstagramOAuthConfig {
    if (!deps.config) {
      throw new NotConfiguredError(
        'Instagram non configurato: inserisci l’app di Instagram in Impostazioni › Account',
      );
    }
    return deps.config;
  }

  return {
    async start(brandId: number): Promise<{ url: string }> {
      const config = requireConfig();
      await deps.brands.ensureExists(brandId);
      const state = createOAuthState(config.stateSecret, { brandId }, deps.now());
      return {
        url: authorizationUrl({ clientId: config.appId, redirectUri: config.redirectUri, state }),
      };
    },

    async complete(query: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    }): Promise<SocialAccount> {
      const config = requireConfig();
      // Lo state si verifica prima di tutto, anche in caso di errore (protezione CSRF).
      const { brandId } = verifyOAuthState(config.stateSecret, query.state ?? '', deps.now());
      if (query.error) throw new OAuthDeniedError(query.error_description ?? query.error);
      if (!query.code) throw new OAuthDeniedError('Codice di autorizzazione mancante');

      const short = await config.client.exchangeCode({
        code: query.code,
        clientId: config.appId,
        clientSecret: config.appSecret,
        redirectUri: config.redirectUri,
      });
      const token = await config.client.exchangeLongLived(short.accessToken, config.appSecret);
      const profile = await config.client.getProfile(token.accessToken);
      const context = tokenContext('instagram', profile.userId);

      const accountId = await upsertSocialAccount(deps.db, {
        brandId,
        platform: 'instagram',
        externalId: profile.userId,
        displayName: `@${profile.username}`,
        handle: profile.username,
        accessTokenEnc: config.cipher.encrypt(token.accessToken, context),
        refreshTokenEnc: null,
        tokenExpiresAt: new Date(deps.now().getTime() + token.expiresInSeconds * 1000),
        refreshTokenExpiresAt: null,
        scopes: INSTAGRAM_SCOPES.join(','),
      });
      return deps.accounts.get(accountId);
    },

    /**
     * Rinnova i token in scadenza (entro 20 giorni, con almeno 24 ore di vita). Un errore su un
     * account non ferma gli altri: resta in `last_error` e lo stato passa a `da_rinnovare`
     * quando la scadenza si avvicina.
     */
    async refreshExpiring(): Promise<{ refreshed: number; failed: number }> {
      if (!deps.config) return { refreshed: 0, failed: 0 };
      const config = deps.config;
      const now = deps.now();
      const rows = await deps.db
        .select()
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.platform, 'instagram'),
            eq(socialAccounts.status, 'collegato'),
            lt(socialAccounts.tokenExpiresAt, new Date(now.getTime() + REFRESH_WITHIN_MS)),
          ),
        );
      let refreshed = 0;
      let failed = 0;
      for (const row of rows) {
        if (!row.tokenExpiresAt || row.tokenExpiresAt <= now) continue;
        if (now.getTime() - row.updatedAt.getTime() < MIN_TOKEN_AGE_MS) continue;
        const context = tokenContext('instagram', row.externalId);
        try {
          const current = config.cipher.decrypt(row.accessTokenEnc, context);
          const token = await config.client.refreshToken(current);
          await deps.db
            .update(socialAccounts)
            .set({
              accessTokenEnc: config.cipher.encrypt(token.accessToken, context),
              tokenExpiresAt: new Date(now.getTime() + token.expiresInSeconds * 1000),
              lastError: null,
            })
            .where(eq(socialAccounts.id, row.id));
          refreshed++;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await deps.db
            .update(socialAccounts)
            .set({ lastError: `Rinnovo del token non riuscito: ${detail}`.slice(0, 1000) })
            .where(eq(socialAccounts.id, row.id));
          failed++;
        }
      }
      return { refreshed, failed };
    },
  };
}

export type InstagramOAuthService = ReturnType<typeof createInstagramOAuthService>;
