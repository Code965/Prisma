import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * `state` OAuth firmato con HMAC: lega la richiesta al brand e scade, senza salvare nulla nel DB.
 * Al rientro, se la firma non torna o è scaduto, la callback risponde 401 (come da guida LinkedIn).
 */
const TTL_MS = 10 * 60_000;

export interface OAuthStatePayload {
  brandId: number;
}

export class InvalidOAuthStateError extends Error {
  constructor(reason: string) {
    super(`State OAuth non valido: ${reason}`);
    this.name = 'InvalidOAuthStateError';
  }
}

function sign(secret: Buffer, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createOAuthState(secret: Buffer, payload: OAuthStatePayload, now: Date): string {
  const data = Buffer.from(
    JSON.stringify({
      b: payload.brandId,
      n: randomBytes(12).toString('base64url'),
      e: now.getTime() + TTL_MS,
    }),
  ).toString('base64url');
  return `${data}.${sign(secret, data)}`;
}

export function verifyOAuthState(secret: Buffer, state: string, now: Date): OAuthStatePayload {
  const [data, signature] = state.split('.');
  if (!data || !signature) throw new InvalidOAuthStateError('formato');
  const expected = Buffer.from(sign(secret, data));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new InvalidOAuthStateError('firma');
  }
  const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
    b?: unknown;
    e?: unknown;
  };
  if (typeof parsed.e !== 'number' || parsed.e < now.getTime()) {
    throw new InvalidOAuthStateError('scaduto');
  }
  if (typeof parsed.b !== 'number') throw new InvalidOAuthStateError('brand');
  return { brandId: parsed.b };
}
