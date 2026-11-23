import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import type { UploadFileRequest } from '../ipc-contract.js';

/** Esito di un PUT: codice HTTP e inizio della risposta (per spiegare un rifiuto). */
export interface PutResult {
  status: number;
  body: string;
}

/** Invia un file con PUT: a flusso, con la lunghezza dichiarata (R2/S3 non accettano upload «chunked»). */
export type PutFile = (
  url: string,
  headers: Record<string, string>,
  path: string,
  sizeBytes: number,
) => Promise<PutResult>;

/** PUT a flusso con il modulo di richiesta indicato (https in produzione, http nei test locali). */
export function createPutFile(requestFn: typeof httpsRequest = httpsRequest): PutFile {
  return (url, headers, path, sizeBytes) =>
    new Promise((resolve, reject) => {
      const req = requestFn(
        url,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Length': String(sizeBytes) },
          // Un video grande richiede tempo: si interrompe solo se la connessione resta ferma.
          timeout: 120_000,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (body.length < 500) body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('Caricamento fermo da 2 minuti')));
      req.on('error', reject);
      createReadStream(path).on('error', reject).pipe(req);
    });
}

export const httpsPutFile: PutFile = createPutFile();

/**
 * Carica un file esportato con l'URL firmato di R2. Il main legge il file da disco (il renderer
 * non ha accesso al file system) e lo invia con gli header che fanno parte della firma.
 * I controlli su percorso e indirizzo li fa chi chiama (`ipc.ts`).
 */
export async function uploadFile(
  request: UploadFileRequest,
  put: PutFile = httpsPutFile,
): Promise<{ sizeBytes: number }> {
  const { size } = await stat(request.localPath);
  const result = await put(request.url, request.headers, request.localPath, size);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `R2 ha rifiutato il caricamento (${result.status}): ${result.body.slice(0, 200)}`,
    );
  }
  return { sizeBytes: size };
}

/** Solo l'endpoint S3 di R2 (gli URL firmati funzionano solo lì, non sui domini pubblici). */
export function isR2UploadUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}
