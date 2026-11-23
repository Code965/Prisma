import { Readable } from 'node:stream';
import type { ObjectStorage, PresignedUpload, StoredObject } from '../../src/storage/types.js';

/** Storage finto in memoria: `put` simula il caricamento fatto dal desktop con l'URL firmato. */
export class FakeStorage implements ObjectStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  readonly signed: string[] = [];

  constructor(private readonly publicBase: string | null = 'https://media.test') {}

  put(key: string, bytes: Buffer, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  async presignPut(key: string, contentType: string): Promise<PresignedUpload> {
    this.signed.push(key);
    return {
      url: `https://bucket.r2.test/${key}?firma=1`,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key);
    return object ? { sizeBytes: object.bytes.length, contentType: object.contentType } : null;
  }

  async readStream(key: string, start = 0, end?: number): Promise<Readable> {
    const bytes = await this.read(key);
    return Readable.from([bytes.subarray(start, end === undefined ? undefined : end + 1)]);
  }

  async read(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Oggetto assente: ${key}`);
    return object.bytes;
  }

  publicUrl(key: string): string | null {
    return this.publicBase ? `${this.publicBase}/${key}` : null;
  }
}
