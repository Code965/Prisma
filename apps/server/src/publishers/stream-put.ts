import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * PUT a flusso con `Content-Length`: gli upload di YouTube (resumable) e TikTok (a pezzi) non
 * accettano il chunked encoding e i video non si tengono in memoria.
 */
export type StreamPut = (
  url: string,
  headers: Record<string, string>,
  body: Readable | null,
) => Promise<RawResponse>;

export const nodeStreamPut: StreamPut = (url, headers, body) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = send(target, { method: 'PUT', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', reject);
    });
    // Se il server resta fermo 2 minuti la connessione si considera persa.
    req.setTimeout(120_000, () => req.destroy(new Error('Connessione ferma da 2 minuti')));
    req.on('error', reject);
    if (body) {
      body.on('error', (error) => req.destroy(error));
      body.pipe(req);
    } else {
      req.end();
    }
  });
