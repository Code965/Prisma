import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { createR2Storage, r2ConfigFromEnv, UPLOAD_URL_TTL_SECONDS } from './r2.js';
import { objectKey } from './types.js';

const config = {
  accountId: 'abc123',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-di-prova',
  bucket: 'prisma',
  publicBaseUrl: 'https://media.example.com',
};

describe('storage R2', () => {
  it('senza tutte le credenziali non è configurato', () => {
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b' } as Env)).toBeNull();
    expect(
      r2ConfigFromEnv({
        R2_ACCOUNT_ID: 'a',
        R2_ACCESS_KEY_ID: 'k',
        R2_SECRET_ACCESS_KEY: 's',
        R2_BUCKET: 'b',
        R2_PUBLIC_BASE_URL: 'https://media.example.com/',
      } as Env),
    ).toMatchObject({ bucket: 'b', publicBaseUrl: 'https://media.example.com' });
  });

  it('firma un PUT sull’endpoint del conto con Content-Type e scadenza', async () => {
    const now = new Date('2026-11-22T10:00:00Z');
    const storage = createR2Storage(config, () => now);
    const upload = await storage.presignPut('brand-1/abc.png', 'image/png');
    const url = new URL(upload.url);
    expect(url.host).toBe('prisma.abc123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/brand-1/abc.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_TTL_SECONDS));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIDEXAMPLE');
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(upload.expiresAt.toISOString()).toBe('2026-11-22T10:15:00.000Z');
  });

  it('costruisce l’indirizzo pubblico e chiavi ricavate dal contenuto', () => {
    const storage = createR2Storage(config);
    expect(storage.publicUrl('brand-1/abc.png')).toBe('https://media.example.com/brand-1/abc.png');
    expect(createR2Storage({ ...config, publicBaseUrl: null }).publicUrl('x')).toBeNull();
    expect(objectKey(7, 'f00d', 'application/pdf')).toBe('brand-7/f00d.pdf');
    expect(objectKey(7, 'f00d', 'image/png')).toBe('brand-7/f00d.png');
  });
});
