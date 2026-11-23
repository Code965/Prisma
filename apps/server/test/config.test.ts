import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '@prisma-app/shared';
import { z } from 'zod';
import { extractBearer, isValidToken } from '../src/auth/api-token.js';
import { parseEnv } from '../src/config/env.js';
import { NotFoundError, VersionConflictError, toErrorResponse } from '../src/http/error-handler.js';

const validEnv = {
  DATABASE_URL: 'mysql://prisma:secret@localhost:3306/prisma',
  API_TOKEN: 'x'.repeat(64),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('configurazione', () => {
  it('applica i default', () => {
    const env = parseEnv(validEnv);
    expect(env.PORT).toBe(4000);
    expect(env.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
  });

  it('toglie gli spazi attorno ai valori (es. dopo l’«=» del .env)', () => {
    const env = parseEnv({ ...validEnv, DEEPSEEK_API_KEY: ' sk-abc ', PORT: ' 4100' });
    expect(env.DEEPSEEK_API_KEY).toBe('sk-abc');
    expect(env.PORT).toBe(4100);
  });

  it('elenca tutti i problemi insieme', () => {
    expect(() => parseEnv({ API_TOKEN: 'corto', TOKEN_ENCRYPTION_KEY: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*API_TOKEN[\s\S]*TOKEN_ENCRYPTION_KEY/,
    );
  });

  it('richiede una chiave di cifratura di 32 byte', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => parseEnv({ ...validEnv, TOKEN_ENCRYPTION_KEY: shortKey })).toThrow(/32 byte/);
  });
});

describe('token API', () => {
  it('estrae il bearer', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('bearer   abc ')).toBe('abc');
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });

  it('confronta i token', () => {
    expect(isValidToken('abc', 'abc')).toBe(true);
    expect(isValidToken('abd', 'abc')).toBe(false);
    expect(isValidToken('ab', 'abc')).toBe(false);
  });
});

describe('mappatura errori', () => {
  it('traduce gli errori di dominio in codici HTTP', () => {
    const zodError = z.object({ a: z.string() }).safeParse({}).error;
    expect(toErrorResponse(zodError).status).toBe(400);
    expect(toErrorResponse(new NotFoundError('idea', 3)).status).toBe(404);
    expect(toErrorResponse(new InvalidTransitionError('variant', 'bozza', 'approve')).status).toBe(
      409,
    );
    expect(toErrorResponse(new VersionConflictError('variant', 3)).body.error).toBe(
      'conflitto_versione',
    );
  });

  it('non espone i dettagli degli errori interni', () => {
    const { status, body } = toErrorResponse(new Error('password=segreta'));
    expect(status).toBe(500);
    expect(body.message).not.toContain('segreta');
  });
});
