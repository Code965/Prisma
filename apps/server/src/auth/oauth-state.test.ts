import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidOAuthStateError, createOAuthState, verifyOAuthState } from './oauth-state.js';

const secret = randomBytes(32);
const now = new Date('2026-11-21T12:00:00Z');

describe('state OAuth', () => {
  it('restituisce il brand se firma e scadenza sono valide', () => {
    const state = createOAuthState(secret, { brandId: 7 }, now);
    expect(verifyOAuthState(secret, state, new Date(now.getTime() + 60_000))).toEqual({
      brandId: 7,
    });
  });

  it('è diverso a ogni richiesta', () => {
    expect(createOAuthState(secret, { brandId: 1 }, now)).not.toBe(
      createOAuthState(secret, { brandId: 1 }, now),
    );
  });

  it('rifiuta state manomessi, firmati con un’altra chiave o scaduti', () => {
    const state = createOAuthState(secret, { brandId: 7 }, now);
    const [data, signature] = state.split('.');
    const forged = Buffer.from(
      JSON.stringify({ b: 99, n: 'x', e: now.getTime() + 60_000 }),
    ).toString('base64url');

    expect(() => verifyOAuthState(secret, `${forged}.${signature}`, now)).toThrow(
      InvalidOAuthStateError,
    );
    expect(() => verifyOAuthState(randomBytes(32), state, now)).toThrow(/firma/);
    expect(() => verifyOAuthState(secret, state, new Date(now.getTime() + 11 * 60_000))).toThrow(
      /scaduto/,
    );
    expect(() => verifyOAuthState(secret, data!, now)).toThrow(/formato/);
    expect(() => verifyOAuthState(secret, '', now)).toThrow(InvalidOAuthStateError);
  });
});
