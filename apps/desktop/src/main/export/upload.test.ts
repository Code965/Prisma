import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPutFile, isR2UploadUrl, uploadFile, type PutFile } from './upload.js';

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

async function tempFile(content: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'prisma-upload-'));
  const path = join(dir, 'carosello.pdf');
  await writeFile(path, content);
  return path;
}

describe('caricamento su R2', () => {
  it('accetta solo l’endpoint S3 di R2 in https', () => {
    expect(isR2UploadUrl('https://prisma.abc.r2.cloudflarestorage.com/brand-1/a.pdf?X-Amz=1')).toBe(
      true,
    );
    expect(isR2UploadUrl('http://prisma.abc.r2.cloudflarestorage.com/a')).toBe(false);
    expect(isR2UploadUrl('https://media.example.com/a')).toBe(false);
    expect(isR2UploadUrl('https://r2.cloudflarestorage.com.evil.test/a')).toBe(false);
  });

  it('invia il file con la sua dimensione e segnala i rifiuti', async () => {
    const localPath = await tempFile('%PDF prova');
    const calls: Array<{ headers: Record<string, string>; size: number }> = [];
    const ok: PutFile = async (_url, headers, _path, size) => {
      calls.push({ headers, size });
      return { status: 200, body: '' };
    };
    const request = {
      localPath,
      url: 'https://b.abc.r2.cloudflarestorage.com/k',
      headers: { 'Content-Type': 'application/pdf' as const },
    };
    expect(await uploadFile(request, ok)).toEqual({ sizeBytes: 10 });
    expect(calls).toEqual([{ headers: { 'Content-Type': 'application/pdf' }, size: 10 }]);

    const denied: PutFile = async () => ({ status: 403, body: 'SignatureDoesNotMatch' });
    await expect(uploadFile(request, denied)).rejects.toThrow(/403.*SignatureDoesNotMatch/);
  });

  it('a flusso: il server riceve Content-Length, tipo e i byte esatti (server http locale)', async () => {
    const localPath = await tempFile('x'.repeat(100_000));
    const received: { length?: string; type?: string; bytes: number } = { bytes: 0 };
    const server = createServer((req, res) => {
      received.length = req.headers['content-length'];
      received.type = req.headers['content-type'];
      req.on('data', (chunk: Buffer) => (received.bytes += chunk.length));
      req.on('end', () => {
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const put = createPutFile(httpRequest as unknown as typeof httpsRequest);
      const result = await uploadFile(
        { localPath, url: `http://127.0.0.1:${port}/k`, headers: { 'Content-Type': 'video/mp4' } },
        put,
      );
      expect(result).toEqual({ sizeBytes: 100_000 });
      expect(received).toEqual({ length: '100000', type: 'video/mp4', bytes: 100_000 });
    } finally {
      server.close();
    }
  });
});
