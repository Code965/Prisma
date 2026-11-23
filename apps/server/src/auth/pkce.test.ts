import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  challengeBase64Url,
  challengeHex,
  createCodeVerifier,
  createVerifierStore,
} from './pkce.js';

describe('PKCE', () => {
  it('verifier di 43-128 caratteri e challenge S256 nei due formati', () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const digest = createHash('sha256').update(verifier).digest();
    expect(challengeBase64Url(verifier)).toBe(digest.toString('base64url'));
    expect(challengeHex(verifier)).toBe(digest.toString('hex'));
  });

  it('il verifier si prende una volta sola e scade dopo 10 minuti', () => {
    let now = new Date('2026-11-23T10:00:00Z');
    const store = createVerifierStore(() => now);
    store.put('s1', 'v1');
    store.put('s2', 'v2');
    expect(store.take('s1')).toBe('v1');
    expect(store.take('s1')).toBeNull();
    now = new Date(now.getTime() + 11 * 60_000);
    expect(store.take('s2')).toBeNull();
  });
});
