import { createHmac } from 'node:crypto';
import type { Env } from '../../config/env.js';
import type { TokenCipher } from '../../crypto/token-cipher.js';
import type { InstagramClient } from '../../publishers/instagram/client.js';
import type { LinkedInClient } from '../../publishers/linkedin/client.js';
import type { TikTokClient } from '../../publishers/tiktok/client.js';
import type { YouTubeClient } from '../../publishers/youtube/client.js';
import type { InstagramOAuthConfig } from './instagram-service.js';
import type { LinkedInOAuthConfig } from './linkedin-service.js';
import type { TikTokOAuthConfig } from './tiktok-service.js';
import type { YouTubeOAuthConfig } from './youtube-service.js';

/**
 * Chiave per firmare lo `state` OAuth, derivata da quella di cifratura: una sola variabile
 * d'ambiente, ma chiavi distinte per usi distinti.
 */
export function deriveStateSecret(encryptionKeyBase64: string): Buffer {
  return createHmac('sha256', Buffer.from(encryptionKeyBase64, 'base64'))
    .update('prisma:oauth-state')
    .digest();
}

export function linkedinOAuthConfig(
  env: Env,
  client: LinkedInClient,
  cipher: TokenCipher,
): LinkedInOAuthConfig | null {
  const clientId = env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    client,
    clientId,
    clientSecret,
    redirectUri: env.LINKEDIN_REDIRECT_URI,
    cipher,
    stateSecret: deriveStateSecret(env.TOKEN_ENCRYPTION_KEY),
  };
}

export function instagramOAuthConfig(
  env: Env,
  client: InstagramClient,
  cipher: TokenCipher,
): InstagramOAuthConfig | null {
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return {
    client,
    appId,
    appSecret,
    redirectUri: env.INSTAGRAM_REDIRECT_URI,
    cipher,
    stateSecret: deriveStateSecret(env.TOKEN_ENCRYPTION_KEY),
  };
}

export function youtubeOAuthConfig(
  env: Env,
  client: YouTubeClient,
  cipher: TokenCipher,
): YouTubeOAuthConfig | null {
  const clientId = env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    client,
    clientId,
    clientSecret,
    redirectUri: env.YOUTUBE_REDIRECT_URI,
    cipher,
    stateSecret: deriveStateSecret(env.TOKEN_ENCRYPTION_KEY),
  };
}

export function tiktokOAuthConfig(
  env: Env,
  client: TikTokClient,
  cipher: TokenCipher,
): TikTokOAuthConfig | null {
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) return null;
  return {
    client,
    clientKey,
    clientSecret,
    redirectUri: env.TIKTOK_REDIRECT_URI,
    cipher,
    stateSecret: deriveStateSecret(env.TOKEN_ENCRYPTION_KEY),
  };
}
