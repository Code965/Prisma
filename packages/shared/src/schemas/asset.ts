import { z } from 'zod';
import { CAROUSEL_LIMITS } from './carousel.js';
import { IdSchema } from './common.js';

/**
 * Export del carosello: JPEG per Instagram e TikTok (Instagram accetta solo JPEG, le foto di TikTok
 * non accettano PNG), PDF per LinkedIn.
 */
export const EXPORT_FORMATS = ['jpg', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'sha256 esadecimale');

export const ExportedFileSchema = z.object({
  position: z
    .int()
    .min(0)
    .max(CAROUSEL_LIMITS.maxSlides - 1),
  mime: z.enum(['image/jpeg', 'application/pdf']),
  sizeBytes: z
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  width: z.int().positive().max(10_000),
  height: z.int().positive().max(10_000),
  checksumSha256: sha256,
  /** Percorso sul computer che ha esportato: serve per caricarlo su R2 (fase 2e). */
  localPath: z.string().min(1).max(1024),
});
export type ExportedFile = z.infer<typeof ExportedFileSchema>;

/**
 * File esportati da registrare sulla variant. `renderHash` è lo sha256 di `renderInputKey`
 * (carosello, brand kit, iniziali) usato per disegnarli: il server lo confronta con lo stato
 * attuale e rifiuta export di slide non più aggiornate.
 */
export const RegisterExportSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  renderHash: sha256,
  files: z.array(ExportedFileSchema).min(1).max(CAROUSEL_LIMITS.maxSlides),
});
export type RegisterExport = z.infer<typeof RegisterExportSchema>;

/** Piattaforme che pubblicano video, e il formato che la variant assume con un video collegato. */
export const VIDEO_VARIANT_FORMAT = {
  youtube: 'video',
  tiktok: 'video',
  instagram: 'reel',
  linkedin: 'video',
} as const;
export type VideoPlatform = keyof typeof VIDEO_VARIANT_FORMAT;

/** Un video esportato (MP4 H.264/AAC) da collegare a una variant. */
export const RegisterVideoSchema = z.object({
  expectedVersion: z.int().nonnegative(),
  file: z.object({
    mime: z.literal('video/mp4'),
    sizeBytes: z
      .int()
      .positive()
      .max(4 * 1024 ** 3),
    width: z.int().positive().max(10_000),
    height: z.int().positive().max(10_000),
    durationMs: z.int().positive(),
    checksumSha256: sha256,
    localPath: z.string().min(1).max(1024),
  }),
});
export type RegisterVideo = z.infer<typeof RegisterVideoSchema>;

export const VariantAssetSchema = z.object({
  assetId: IdSchema,
  kind: z.enum(['image', 'pdf', 'video', 'audio']),
  role: z.enum(['media', 'copertina']),
  position: z.int().nonnegative(),
  mime: z.string(),
  sizeBytes: z.int().nonnegative(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  durationMs: z.int().nullable(),
  checksumSha256: z.string(),
  localPath: z.string().nullable(),
  /** Chiave su R2: valorizzata quando il caricamento è stato verificato. */
  remoteKey: z.string().nullable(),
  /** Indirizzo pubblico (se il bucket ne ha uno): serve alle piattaforme che scaricano da sé. */
  remoteUrl: z.string().nullable(),
  /** false se slide o brand kit sono cambiati dopo l'export: va rifatto prima di pubblicare. */
  upToDate: z.boolean(),
});
export type VariantAsset = z.infer<typeof VariantAssetSchema>;

/** Dove caricare un file: URL firmato di R2 con gli header che fanno parte della firma. */
export const UploadTargetSchema = z.object({
  key: z.string(),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type UploadTarget = z.infer<typeof UploadTargetSchema>;

export const StorageStatusSchema = z.object({
  configured: z.boolean(),
  /** false se manca l'indirizzo pubblico del bucket: Instagram non potrà scaricare le immagini. */
  publicUrls: z.boolean(),
});
export type StorageStatus = z.infer<typeof StorageStatusSchema>;
