import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636) per i login dalle app desktop: Google e TikTok lo richiedono con il ritorno
 * su 127.0.0.1. Il `code_verifier` resta sul server, legato allo `state` del login, per 10
 * minuti (quanto vale lo state).
 */
const TTL_MS = 10 * 60_000;

export function createCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

/** S256 standard (Google): base64url dello SHA-256. */
export function challengeBase64Url(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** S256 di TikTok per desktop: lo SHA-256 in esadecimale. */
export function challengeHex(verifier: string): string {
  return createHash('sha256').update(verifier).digest('hex');
}

export function createVerifierStore(now: () => Date = () => new Date()) {
  const entries = new Map<string, { verifier: string; expiresAt: number }>();
  const sweep = () => {
    const at = now().getTime();
    for (const [key, entry] of entries) if (entry.expiresAt <= at) entries.delete(key);
  };
  return {
    put(state: string, verifier: string): void {
      sweep();
      entries.set(state, { verifier, expiresAt: now().getTime() + TTL_MS });
    },
    /** Il verifier si usa una volta sola. */
    take(state: string): string | null {
      sweep();
      const entry = entries.get(state);
      entries.delete(state);
      return entry?.verifier ?? null;
    },
  };
}

export type VerifierStore = ReturnType<typeof createVerifierStore>;
