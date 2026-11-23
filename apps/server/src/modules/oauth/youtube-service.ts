import type { SocialAccount } from '@prisma-app/shared';
import { createOAuthState, verifyOAuthState } from '../../auth/oauth-state.js';
import { challengeBase64Url, createCodeVerifier, createVerifierStore } from '../../auth/pkce.js';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { NotConfiguredError } from '../../http/error-handler.js';
import {
  GoogleHttpError,
  YOUTUBE_SCOPES,
  authorizationUrl,
  type YouTubeClient,
} from '../../publishers/youtube/client.js';
import { PublishError } from '../../publishers/types.js';
import type { BrandService } from '../brands/service.js';
import { upsertSocialAccount } from '../social-accounts/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';
import type { TokenRefresher } from '../social-accounts/tokens.js';
import { OAuthDeniedError } from './linkedin-service.js';

export interface YouTubeOAuthConfig {
  client: YouTubeClient;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  cipher: TokenCipher;
  stateSecret: Buffer;
}

/**
 * Nuovo token di accesso Google dal refresh token. `invalid_grant` = accesso revocato o refresh
 * token scaduto (7 giorni con l'app OAuth in «Testing», 6 mesi senza uso): si ricollega.
 */
export function youtubeTokenRefresher(config: YouTubeOAuthConfig): TokenRefresher {
  return async (refreshToken) => {
    try {
      const tokens = await config.client.refresh({
        refreshToken,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
      return { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds };
    } catch (error) {
      if (error instanceof GoogleHttpError && (error.status === 400 || error.status === 401)) {
        throw new PublishError(
          'Accesso a YouTube scaduto o revocato: ricollega l’account nelle Impostazioni',
          false,
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new PublishError(`Rinnovo del token YouTube non riuscito: ${detail}`, true);
    }
  };
}

/**
 * Collegamento del canale YouTube: codice → token di accesso (1 ora) e refresh token, conservati
 * cifrati. Il token di accesso non si salva come scadenza dell'account: se ne chiede uno nuovo a
 * ogni uso, quindi l'account non risulta mai «da rinnovare» per un token che dura un'ora.
 */
export function createYouTubeOAuthService(deps: {
  db: DbExecutor;
  config: YouTubeOAuthConfig | null;
  brands: BrandService;
  accounts: SocialAccountService;
  now: () => Date;
}) {
  function requireConfig(): YouTubeOAuthConfig {
    if (!deps.config) {
      throw new NotConfiguredError(
        'YouTube non configurato: inserisci l’app di YouTube in Impostazioni › Account',
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
          codeChallenge: challengeBase64Url(verifier),
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
      const codeVerifier = verifiers.take(query.state ?? '');
      if (!codeVerifier) throw new OAuthDeniedError('Login scaduto o già usato: riprova da Prisma');

      const tokens = await config.client.exchangeCode({
        code: query.code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        codeVerifier,
      });
      if (!tokens.refreshToken) {
        throw new OAuthDeniedError(
          'Google non ha concesso l’accesso offline: rimuovi Prisma dagli accessi del tuo account Google e ricollega',
        );
      }
      const channel = await config.client.getChannel(tokens.accessToken);
      const context = tokenContext('youtube', channel.id);
      const accountId = await upsertSocialAccount(deps.db, {
        brandId,
        platform: 'youtube',
        externalId: channel.id,
        displayName: channel.title,
        handle: channel.customUrl?.replace(/^@/, '') ?? null,
        accessTokenEnc: config.cipher.encrypt(tokens.accessToken, context),
        refreshTokenEnc: config.cipher.encrypt(tokens.refreshToken, context),
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scopes: YOUTUBE_SCOPES.join(' '),
      });
      return deps.accounts.get(accountId);
    },
  };
}

export type YouTubeOAuthService = ReturnType<typeof createYouTubeOAuthService>;
