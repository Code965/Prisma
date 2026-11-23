import type { Platform } from '@prisma-app/shared';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import { PublishError } from '../../publishers/types.js';

/** Token restituiti da un rinnovo; TikTok fa ruotare anche il refresh token. */
export interface RefreshedTokens {
  accessToken: string;
  expiresInSeconds: number;
  /** Nuovo refresh token (TikTok: quello vecchio smette subito di valere). */
  refreshToken?: string | null;
  refreshExpiresInSeconds?: number | null;
}

/**
 * Nuovi token dal refresh token. Per gli errori lancia un `PublishError` che dice se riprovare
 * ha senso (rete sì, accesso revocato no).
 */
export type TokenRefresher = (refreshToken: string) => Promise<RefreshedTokens>;

export interface StoredAccountTokens {
  id: number;
  platform: Platform;
  externalId: string;
  accessTokenEnc: Buffer;
  refreshTokenEnc: Buffer | null;
  tokenExpiresAt: Date | null;
}

/** Valori cifrati da salvare sull'account dopo un rinnovo. */
export interface PersistedTokens {
  accessTokenEnc: Buffer;
  tokenExpiresAt: Date;
  refreshTokenEnc?: Buffer;
  refreshTokenExpiresAt?: Date | null;
}

export type AccessTokenResolver = (account: StoredAccountTokens) => Promise<string>;

/** Un token che scade entro questo margine si rinnova prima di usarlo (un upload dura minuti). */
const EXPIRY_MARGIN_MS = 10 * 60_000;

/**
 * Token di accesso da usare con la piattaforma. Per le piattaforme con refresh token (YouTube:
 * un'ora, TikTok: due ore) si usa quello salvato finché è valido, altrimenti si rinnova e si
 * salvano i token nuovi, compreso il refresh token ruotato. Per le altre si decifra quello salvato.
 */
export function createAccessTokenResolver(
  cipher: TokenCipher,
  refreshers: Partial<Record<Platform, TokenRefresher>> = {},
  options: {
    persist?: (accountId: number, values: PersistedTokens) => Promise<void>;
    now?: () => Date;
  } = {},
): AccessTokenResolver {
  const now = options.now ?? (() => new Date());

  function decrypt(value: Buffer, account: StoredAccountTokens): string {
    try {
      return cipher.decrypt(value, tokenContext(account.platform, account.externalId));
    } catch {
      throw new PublishError('Token dell’account non leggibile: ricollega l’account', false);
    }
  }

  return async (account) => {
    const refresher = refreshers[account.platform];
    const at = now().getTime();
    const stillValid =
      account.tokenExpiresAt !== null && account.tokenExpiresAt.getTime() - at > EXPIRY_MARGIN_MS;
    if (!refresher || !account.refreshTokenEnc || stillValid) {
      return decrypt(account.accessTokenEnc, account);
    }
    const tokens = await refresher(decrypt(account.refreshTokenEnc, account));
    const context = tokenContext(account.platform, account.externalId);
    await options.persist?.(account.id, {
      accessTokenEnc: cipher.encrypt(tokens.accessToken, context),
      tokenExpiresAt: new Date(at + tokens.expiresInSeconds * 1000),
      ...(tokens.refreshToken
        ? {
            refreshTokenEnc: cipher.encrypt(tokens.refreshToken, context),
            refreshTokenExpiresAt: tokens.refreshExpiresInSeconds
              ? new Date(at + tokens.refreshExpiresInSeconds * 1000)
              : null,
          }
        : {}),
    });
    return tokens.accessToken;
  };
}
