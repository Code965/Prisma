import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenDecryptionError, createTokenCipher, tokenContext } from './token-cipher.js';

const key = randomBytes(32).toString('base64');
const context = tokenContext('linkedin', 'urn:li:person:abc');

describe('cifratura dei token', () => {
  const cipher = createTokenCipher(key);

  it('cifra e decifra', () => {
    const payload = cipher.encrypt('token-segreto', context);
    expect(payload.toString('utf8')).not.toContain('token-segreto');
    expect(cipher.decrypt(payload, context)).toBe('token-segreto');
  });

  it('usa un IV diverso a ogni cifratura', () => {
    const a = cipher.encrypt('uguale', context);
    const b = cipher.encrypt('uguale', context);
    expect(a.equals(b)).toBe(false);
  });

  it('rileva dati manomessi', () => {
    const payload = cipher.encrypt('token', context);
    payload[payload.length - 1]! ^= 0xff;
    expect(() => cipher.decrypt(payload, context)).toThrow(TokenDecryptionError);
  });

  it('non decifra con un’altra chiave o un altro account', () => {
    const payload = cipher.encrypt('token', context);
    const other = createTokenCipher(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(payload, context)).toThrow(TokenDecryptionError);
    expect(() => cipher.decrypt(payload, tokenContext('linkedin', 'altro'))).toThrow(
      TokenDecryptionError,
    );
  });

  it('rifiuta payload troppo corti o di versione sconosciuta', () => {
    expect(() => cipher.decrypt(Buffer.alloc(5), context)).toThrow(/troppo corto/);
    const payload = cipher.encrypt('token', context);
    payload[0] = 9;
    expect(() => cipher.decrypt(payload, context)).toThrow(/versione/);
  });

  it('richiede una chiave di 32 byte', () => {
    expect(() => createTokenCipher(randomBytes(16).toString('base64'))).toThrow(/32 byte/);
  });
});
