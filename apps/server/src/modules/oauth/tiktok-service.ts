import type { SocialAccount } from '@prisma-app/shared';
import { createOAuthState, verifyOAuthState } from '../../auth/oauth-state.js';
import { challengeHex, createCodeVerifier, createVerifierStore } from '../../auth/pkce.js';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { NotConfiguredError } from '../../http/error-handler.js';
import {
  TIKTOK_SCOPES,
  TikTokHttpError,
  authorizationUrl,
  type TikTokClient,
} from '../../publishers/tiktok/client.js';
import { PublishError } from '../../publishers/types.js';
import type { BrandService } from '../brands/service.js';
import { upsertSocialAccount } from '../social-accounts/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';
import type { TokenRefresher } from '../social-accounts/tokens.js';
import { OAuthDeniedError } from './linkedin-service.js';

export interface TikTokOAuthConfig {
  client: TikTokClient;
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  cipher: TokenCipher;
  stateSecret: Buffer;
}

/** Rinnovo del token TikTok: il refresh token restituito sostituisce subito quello vecchio. */
export function tiktokTokenRefresher(config: TikTokOAuthConfig): TokenRefresher {
  return async (refreshToken) => {
    try {
      const tokens = await config.client.refresh({
        refreshToken,
        clientKey: config.clientKey,
        clientSecret: config.clientSecret,
      });
      return {
        accessToken: tokens.accessToken,
        expiresInSeconds: tokens.expiresInSeconds,
        refreshToken: tokens.refreshToken,
        refreshExpiresInSeconds: tokens.refreshExpiresInSeconds,
      };
    } catch (error) {
      if (error instanceof TikTokHttpError && error.status >= 400 && error.status < 500) {
        throw new PublishError(
          'Accesso a TikTok scaduto o revocato: ricollega l’account nelle Impostazioni',
          false,
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new PublishError(`Rinnovo del token TikTok non riuscito: ${detail}`, true);
    }
  };
}

/**
 * Collegamento dell'account TikTok (Login Kit, scope `user.info.basic,video.upload`): codice →
 * token di accesso (2 ore) e refresh token (180 giorni, ruota a ogni rinnovo), cifrati.
 */
export function createTikTokOAuthService(deps: {
  db: DbExecutor;
  config: TikTokOAuthConfig | null;
  brands: BrandService;
  accounts: SocialAccountService;
  now: () => Date;
}) {
  function requireConfig(): TikTokOAuthConfig {
    if (!deps.config) {
      throw new NotConfiguredError(
        'TikTok non configurato: inserisci l’app di TikTok in Impostazioni › Account',
      );
    }
    return deps.config;
  }
  // PKCE: il verifier resta qui, legato allo state del login.
  const verifiers = createVerifierStore(deps.now);

  return {
    async start(brandId: number): Promise<{ url: string }> {
      const config = requireConfig();
      await deps.brands.ensureExists(brandId);
      const state = createOAuthState(config.stateSecret, { brandId }, deps.now());
      const verifier = createCodeVerifier();
      verifiers.put(state, verifier);
      return {
        url: authorizationUrl({
          codeChallenge: challengeHex(verifier),
          clientKey: config.clientKey,
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
      const codeVerifier = verifiers.take(query.state ?? '');
      if (!codeVerifier) throw new OAuthDeniedError('Login scaduto o già usato: riprova da Prisma');

      const tokens = await config.client.exchangeCode({
        code: query.code,
        clientKey: config.clientKey,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        codeVerifier,
      });
      const profile = await config.client.getProfile(tokens.accessToken);
      const context = tokenContext('tiktok', tokens.openId);
      const now = deps.now().getTime();
      const accountId = await upsertSocialAccount(deps.db, {
        brandId,
        platform: 'tiktok',
        externalId: tokens.openId,
        displayName: profile.displayName,
        handle: null,
        accessTokenEnc: config.cipher.encrypt(tokens.accessToken, context),
        refreshTokenEnc: config.cipher.encrypt(tokens.refreshToken, context),
        tokenExpiresAt: new Date(now + tokens.expiresInSeconds * 1000),
        refreshTokenExpiresAt: new Date(now + tokens.refreshExpiresInSeconds * 1000),
        scopes: TIKTOK_SCOPES.join(','),
      });
      return deps.accounts.get(accountId);
    },
  };
}

export type TikTokOAuthService = ReturnType<typeof createTikTokOAuthService>;
