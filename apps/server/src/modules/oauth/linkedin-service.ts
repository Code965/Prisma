import type { SocialAccount } from '@prisma-app/shared';
import { createOAuthState, verifyOAuthState } from '../../auth/oauth-state.js';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { NotConfiguredError } from '../../http/error-handler.js';
import { authorizationUrl, type LinkedInClient } from '../../publishers/linkedin/client.js';
import type { BrandService } from '../brands/service.js';
import { upsertSocialAccount } from '../social-accounts/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';

export interface LinkedInOAuthConfig {
  client: LinkedInClient;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  cipher: TokenCipher;
  /** Chiave per firmare lo `state`, derivata da quella di cifratura. */
  stateSecret: Buffer;
}

/** L'utente ha negato il consenso o LinkedIn ha restituito un errore nella callback. */
export class OAuthDeniedError extends Error {
  constructor(description: string) {
    super(description);
    this.name = 'OAuthDeniedError';
  }
}

export function createLinkedInOAuthService(deps: {
  db: DbExecutor;
  config: LinkedInOAuthConfig | null;
  brands: BrandService;
  accounts: SocialAccountService;
  now: () => Date;
}) {
  function requireConfig(): LinkedInOAuthConfig {
    if (!deps.config) {
      throw new NotConfiguredError(
        'LinkedIn non configurato: inserisci l’app di LinkedIn in Impostazioni › Account',
      );
    }
    return deps.config;
  }

  return {
    /** URL da aprire nel browser per autorizzare l'app sul proprio profilo LinkedIn. */
    async start(brandId: number): Promise<{ url: string }> {
      const config = requireConfig();
      await deps.brands.ensureExists(brandId);
      const state = createOAuthState(config.stateSecret, { brandId }, deps.now());
      return {
        url: authorizationUrl({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          state,
        }),
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

      const token = await config.client.exchangeCode({
        code: query.code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
      });
      const profile = await config.client.getUserInfo(token.accessToken);
      const context = tokenContext('linkedin', profile.sub);
      const now = deps.now().getTime();

      const accountId = await upsertSocialAccount(deps.db, {
        brandId,
        platform: 'linkedin',
        externalId: profile.sub,
        displayName: profile.name,
        handle: null,
        accessTokenEnc: config.cipher.encrypt(token.accessToken, context),
        refreshTokenEnc: token.refreshToken
          ? config.cipher.encrypt(token.refreshToken, context)
          : null,
        tokenExpiresAt: new Date(now + token.expiresInSeconds * 1000),
        refreshTokenExpiresAt: token.refreshExpiresInSeconds
          ? new Date(now + token.refreshExpiresInSeconds * 1000)
          : null,
        scopes: token.scope,
      });
      return deps.accounts.get(accountId);
    },
  };
}

export type LinkedInOAuthService = ReturnType<typeof createLinkedInOAuthService>;
