import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import type { Env } from '../config/env.js';
import type { ListedObject, ObjectStorage, PresignedUpload, StoredObject } from './types.js';

/**
 * Cloudflare R2 con l'SDK S3 (developers.cloudflare.com/r2, verificato novembre 2026):
 * endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, regione `auto` (richiesta dall'SDK,
 * ignorata da R2), URL firmati per PUT/GET/HEAD validi da 1 secondo a 7 giorni. Il Content-Type
 * fa parte della firma: il caricamento deve inviarlo identico.
 */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string | null;
  endpoint?: string;
}

/** Un caricamento dura pochi secondi: un quarto d'ora basta anche con connessioni lente. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export function r2ConfigFromEnv(env: Env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? null,
    endpoint: env.R2_ENDPOINT,
  };
}

export function createR2Storage(
  config: R2Config,
  now: () => Date = () => new Date(),
): ObjectStorage {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 non chiede checksum aggiuntivi: l'URL firmato resta un semplice PUT con Content-Type.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = config.bucket;

  return {
    async presignPut(key: string, contentType: string): Promise<PresignedUpload> {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        // Senza questa opzione l'SDK non firma il Content-Type e R2 accetterebbe qualsiasi tipo.
        { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type']) },
      );
      return {
        url,
        headers: { 'Content-Type': contentType },
        expiresAt: new Date(now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
      };
    },

    async head(key: string): Promise<StoredObject | null> {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
      } catch (error) {
        if (error instanceof NotFound) return null;
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
          return null;
        }
        throw error;
      }
    },

    async read(key: string): Promise<Buffer> {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!result.Body) throw new Error(`Oggetto ${key} senza contenuto`);
      return Buffer.from(await result.Body.transformToByteArray());
    },

    async readStream(key: string, start = 0, end?: number): Promise<Readable> {
      const range =
        end !== undefined ? `bytes=${start}-${end}` : start > 0 ? `bytes=${start}-` : undefined;
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: range }));
      if (!(result.Body instanceof Readable)) throw new Error(`Oggetto ${key} senza contenuto`);
      return result.Body;
    },

    publicUrl(key: string): string | null {
      if (!config.publicBaseUrl) return null;
      return `${config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
    },

    async list(prefix: string): Promise<ListedObject[]> {
      const found: ListedObject[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const item of page.Contents ?? []) {
          if (!item.Key) continue;
          found.push({
            key: item.Key,
            sizeBytes: item.Size ?? 0,
            lastModified: item.LastModified ?? new Date(0),
          });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return found;
    },

    async remove(keys: readonly string[]): Promise<void> {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (result.Errors?.length) {
          const first = result.Errors[0]!;
          throw new Error(
            `R2 non ha eliminato ${result.Errors.length} oggetti: ${first.Key} ${first.Message ?? ''}`,
          );
        }
      }
    },
  };
}
