import type { Readable } from 'node:stream';

/**
 * Spazio per i file finali da pubblicare (Cloudflare R2, API S3). Il desktop carica i file con
 * un URL firmato; il server li verifica, li legge per le piattaforme che vogliono i byte
 * (LinkedIn) e ne dà l'indirizzo pubblico a quelle che li scaricano da sé (Instagram).
 */
export interface PresignedUpload {
  url: string;
  /** Header da inviare così come sono: fanno parte della firma. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

export interface ObjectStorage {
  presignPut(key: string, contentType: string): Promise<PresignedUpload>;
  /** null se l'oggetto non esiste. */
  head(key: string): Promise<StoredObject | null>;
  read(key: string): Promise<Buffer>;
  /** Lettura a flusso da `start` a `end` incluso, o fino alla fine (i video non si tengono in memoria). */
  readStream(key: string, start?: number, end?: number): Promise<Readable>;
  /** Indirizzo pubblico dell'oggetto, se il bucket ne ha uno. */
  publicUrl(key: string): string | null;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
};

/**
 * Chiave dell'oggetto, ricavata dal contenuto: lo stesso file ha sempre la stessa chiave, quindi
 * ricaricarlo non crea doppioni e un file diverso non ne sovrascrive un altro.
 */
export function objectKey(brandId: number, checksumSha256: string, mime: string): string {
  const extension = EXTENSIONS[mime] ?? 'bin';
  return `brand-${brandId}/${checksumSha256}.${extension}`;
}
