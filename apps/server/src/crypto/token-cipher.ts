import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Formato del payload cifrato: versione (1 byte) | IV (12) | auth tag (16) | ciphertext.
 * La versione permette in futuro di ruotare la chiave senza ambiguità.
 */
const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;
const ALGORITHM = 'aes-256-gcm';

export class TokenDecryptionError extends Error {
  constructor(reason: string) {
    super(`Impossibile decifrare il token: ${reason}`);
    this.name = 'TokenDecryptionError';
  }
}

export interface TokenCipher {
  /** `context` (AAD) lega il token al suo account: copiato su un altro account non si decifra. */
  encrypt(plaintext: string, context: string): Buffer;
  decrypt(payload: Buffer, context: string): string;
}

export function createTokenCipher(keyBase64: string): TokenCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('La chiave di cifratura deve essere di 32 byte');

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
    },

    decrypt(payload, context) {
      if (payload.length < HEADER_LENGTH) throw new TokenDecryptionError('payload troppo corto');
      if (payload[0] !== FORMAT_VERSION) throw new TokenDecryptionError('versione sconosciuta');
      const iv = payload.subarray(1, 1 + IV_LENGTH);
      const tag = payload.subarray(1 + IV_LENGTH, HEADER_LENGTH);
      const ciphertext = payload.subarray(HEADER_LENGTH);
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw new TokenDecryptionError('chiave, contesto o dati non validi');
      }
    },
  };
}

/** Contesto AAD di un token: noto già prima di salvare l'account. */
export function tokenContext(platform: string, externalId: string): string {
  return `social_account:${platform}:${externalId}`;
}
