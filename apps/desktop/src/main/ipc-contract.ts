import {
  BrandKitSchema,
  CarouselSchema,
  EXPORT_FORMATS,
  IdSchema,
  TRANSCRIPT_LANGUAGES,
  VideoEditSchema,
  VIDEO_TOOLS,
  type ExportedFile,
  type ExportFormat,
} from '@prisma-app/shared';
import { z } from 'zod';

/**
 * Contratto dei messaggi tra renderer e main. Il main valida ogni richiesta con questi schemi:
 * il renderer è trattato come non fidato (potrebbe caricare contenuti esterni in futuro).
 */
export const IPC = {
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  apiRequest: 'api:request',
  openExternal: 'external:open',
  exportCarousel: 'carousel:export',
  showExport: 'export:show',
  uploadFile: 'upload:file',
  toolsStatus: 'tools:status',
  setToolPath: 'tools:set',
  pickToolPath: 'tools:pick',
  listVideos: 'video:list',
  importVideo: 'video:import',
  removeVideo: 'video:remove',
  transcribeVideo: 'video:transcribe',
  cancelVideoJob: 'video:cancel',
  saveVideoEdit: 'video:save-edit',
  renderVideo: 'video:render',
  renderStatus: 'video:render-status',
  createShort: 'video:create-short',
  filmcraftStatus: 'filmcraft:status',
  filmcraftOpen: 'filmcraft:open',
  filmcraftExport: 'filmcraft:export',
  filmcraftUseReturn: 'filmcraft:use-return',
  updateState: 'updates:state',
  updateCheck: 'updates:check',
  updateDismiss: 'updates:dismiss',
  updateSkip: 'updates:skip',
  updateInstall: 'updates:install',
  restartApp: 'app:restart',
} as const;

/** Evento dal main al renderer quando cambia lo stato degli aggiornamenti. */
export const UPDATE_STATE_EVENT = 'updates:changed';

/** Evento dal main al renderer con l'avanzamento dei lavori sui video. */
export const VIDEO_PROGRESS_EVENT = 'video:progress';

/** Dove stanno i dati: dentro l'app (predefinito) o su un server Prisma separato. */
export const CONNECTION_MODES = ['locale', 'remoto'] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export const ConnectionSettingsSchema = z.object({
  mode: z.enum(CONNECTION_MODES).default('locale'),
  serverUrl: z.url().refine((url) => /^https?:\/\//.test(url), 'Serve un indirizzo http o https'),
  /** Assente = lascia invariato il token salvato. */
  apiToken: z.string().trim().min(32).optional(),
});
export type ConnectionSettingsInput = z.input<typeof ConnectionSettingsSchema>;

export interface ConnectionSettingsView {
  mode: ConnectionMode;
  serverUrl: string;
  hasToken: boolean;
  /** Da dove arriva il token: salvato cifrato, oppure letto dal .env in sviluppo. */
  tokenSource: 'salvato' | 'env-sviluppo' | 'assente';
  /** Modalità in uso adesso: cambia solo dopo il riavvio dell'app. */
  activeMode: ConnectionMode;
  /** File del database quando i dati stanno sul computer. */
  databasePath: string | null;
}

export const ApiRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Solo percorsi relativi al server: niente URL completi o risalite di cartella. */
  path: z
    .string()
    .regex(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%?]*$/, 'Percorso non valido')
    .refine((path) => !path.includes('..') && !path.startsWith('//'), 'Percorso non valido'),
  body: z.unknown().optional(),
});
export type ApiRequest = z.infer<typeof ApiRequestSchema>;

export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * Dal renderer verso l'esterno si aprono solo le autorizzazioni OAuth delle piattaforme e le
 * pagine dove si creano le app sviluppatore (guide delle Impostazioni).
 */
const EXTERNAL_PREFIXES = [
  'https://www.linkedin.com/oauth/',
  'https://www.instagram.com/oauth/authorize?',
  'https://accounts.google.com/o/oauth2/v2/auth?',
  'https://www.tiktok.com/v2/auth/authorize/?',
  'https://www.linkedin.com/developers/apps',
  'https://developers.facebook.com/apps',
  'https://console.cloud.google.com/apis/credentials',
  'https://developers.tiktok.com/apps',
  'https://dash.cloudflare.com/',
];

export const ExternalUrlSchema = z
  .url()
  .refine(
    (url) => EXTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix)),
    'Indirizzo non consentito',
  );

/**
 * Export del carosello: il renderer manda le slide salvate e il brand kit che ha usato per le
 * anteprime; il main le ridisegna con i font incorporati e scrive i file nella cartella dati.
 */
export const ExportCarouselRequestSchema = z.object({
  variantId: IdSchema,
  format: z.enum(EXPORT_FORMATS),
  carousel: CarouselSchema,
  kit: BrandKitSchema,
  initials: z.string().max(3),
});
export type ExportCarouselRequest = z.infer<typeof ExportCarouselRequestSchema>;

export interface ExportCarouselResult {
  format: ExportFormat;
  folder: string;
  /** sha256 di `renderInputKey`: il server lo confronta con lo stato attuale. */
  renderHash: string;
  files: ExportedFile[];
}

/** Si mostra in Esplora risorse solo ciò che sta nella cartella degli export. */
export const ShowExportSchema = z.string().min(1).max(1024);

/**
 * Caricamento su R2 di un file esportato: percorso dentro la cartella degli export, URL firmato
 * dell'endpoint S3 di R2, solo l'header Content-Type (firmato) con i tipi esportati.
 */
export const UploadFileRequestSchema = z.object({
  localPath: z.string().min(1).max(1024),
  url: z.url(),
  headers: z
    .object({ 'Content-Type': z.enum(['image/jpeg', 'application/pdf', 'video/mp4']) })
    .strict(),
});
export type UploadFileRequest = z.infer<typeof UploadFileRequestSchema>;

/** Percorso di uno strumento video impostato a mano; null torna al rilevamento automatico. */
export const SetToolPathSchema = z.object({
  tool: z.enum(VIDEO_TOOLS),
  path: z.string().min(1).max(1024).nullable(),
});
export type SetToolPath = z.infer<typeof SetToolPathSchema>;

export const VideoToolSchema = z.enum(VIDEO_TOOLS);

export const VideoProjectIdSchema = z.uuid();

export const TranscribeRequestSchema = z.object({
  projectId: z.uuid(),
  language: z.enum(TRANSCRIPT_LANGUAGES),
});
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;

/** Progetto Short ricavato da un video lungo dopo «Genera Short». */
export const CreateShortRequestSchema = z
  .object({
    parentId: z.uuid(),
    contentId: IdSchema,
    title: z.string().trim().min(1).max(200),
    startMs: z.int().nonnegative(),
    endMs: z.int().positive(),
  })
  .refine((r) => r.endMs > r.startMs, { message: 'Fine prima dell’inizio' });
export type CreateShortRequest = z.infer<typeof CreateShortRequestSchema>;

/** «Apri in FilmCraft»; `rebuild` ricrea il progetto FilmCraft dalle modifiche di Prisma. */
export const FilmcraftOpenSchema = z.object({
  projectId: z.uuid(),
  rebuild: z.boolean().default(false),
});
export type FilmcraftOpen = z.input<typeof FilmcraftOpenSchema>;

export const SaveVideoEditSchema = z.object({
  projectId: z.uuid(),
  edit: VideoEditSchema,
});
