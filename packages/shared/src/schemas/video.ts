import { z } from 'zod';
import { IdSchema, InstantSchema } from './common.js';
import { TranscriptSchema } from './transcript.js';
import { DEFAULT_VIDEO_EDIT, VIDEO_FORMATS, VideoEditSchema } from './video-edit.js';

/**
 * Progetti video (fase 3): vivono solo sul desktop, in SQLite, perché i file sorgente sono sul
 * computer. Al server arriva solo il video finito, come asset della variant.
 */

/** Metadati del file sorgente letti con ffprobe. */
export const VideoSourceSchema = z.object({
  path: z.string().min(1),
  fileName: z.string(),
  sizeBytes: z.int().nonnegative(),
  durationMs: z.int().nonnegative(),
  width: z.int().positive(),
  height: z.int().positive(),
  fps: z.number().positive(),
  videoCodec: z.string().nullable(),
  hasAudio: z.boolean(),
});
export type VideoSource = z.infer<typeof VideoSourceSchema>;

/** Ultimo video esportato con FFmpeg (passo 3d). */
export const VideoRenderSchema = z.object({
  path: z.string().min(1),
  format: z.enum(VIDEO_FORMATS),
  width: z.int().positive(),
  height: z.int().positive(),
  durationMs: z.int().nonnegative(),
  sizeBytes: z.int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** `prisma` = render con FFmpeg dalle modifiche; `filmcraft` = file rientrato da FilmCraft. */
  origin: z
    .preprocess(
      // Progetti salvati prima del cambio di nome (Cronaca → Prisma).
      (value) => (value === 'cronaca' ? 'prisma' : value),
      z.enum(['prisma', 'filmcraft']),
    )
    .default('prisma'),
  /** sha256 di `videoRenderKey`: se cambia, il file non corrisponde più alle modifiche. */
  renderKey: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: InstantSchema,
});
export type VideoRender = z.infer<typeof VideoRenderSchema>;

/** File esportato da FilmCraft e riportato in Prisma. */
export const FilmcraftReturnSchema = z.object({
  path: z.string().min(1),
  width: z.int().positive(),
  height: z.int().positive(),
  durationMs: z.int().nonnegative(),
  sizeBytes: z.int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: InstantSchema,
});
export type FilmcraftReturn = z.infer<typeof FilmcraftReturnSchema>;

/**
 * Progetto aperto in FilmCraft (passo 3e): il `.fcproj` creato da Prisma, le modifiche da cui è
 * partito (sha256 di `videoRenderKey`) e l'ultimo file rientrato.
 */
export const VideoFilmcraftSchema = z.object({
  projectPath: z.string().min(1),
  editKey: z.string().regex(/^[a-f0-9]{64}$/),
  openedAt: InstantSchema,
  returned: FilmcraftReturnSchema.nullable().default(null),
});
export type VideoFilmcraft = z.infer<typeof VideoFilmcraftSchema>;

/** Progetto nato da «Genera Short»: il momento del video lungo e il contenuto nello Studio. */
export const VideoShortOriginSchema = z.object({
  parentId: z.uuid(),
  contentId: IdSchema,
  startMs: z.int().nonnegative(),
  endMs: z.int().positive(),
});
export type VideoShortOrigin = z.infer<typeof VideoShortOriginSchema>;

/** Video creato da Prisma («Crea video dall'idea»): da dove viene e con quale voce. */
export const VideoGeneratedSchema = z.object({
  source: z.enum(['idea', 'variant']),
  sourceId: IdSchema,
  /** «Voce Piper it_IT-paola-medium» o «Voce di Windows Microsoft Elsa». */
  voice: z.string().max(200),
  scenes: z.int().positive(),
});
export type VideoGenerated = z.infer<typeof VideoGeneratedSchema>;

export const VideoProjectSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  source: VideoSourceSchema,
  /** Trascrizione con i tempi per parola; null finché non si trascrive. */
  transcript: TranscriptSchema.nullable().default(null),
  /** Tagli, formato e sottotitoli scelti nell'editor (il file sorgente non cambia). */
  edit: VideoEditSchema.default(DEFAULT_VIDEO_EDIT),
  render: VideoRenderSchema.nullable().default(null),
  short: VideoShortOriginSchema.nullable().default(null),
  generated: VideoGeneratedSchema.nullable().default(null),
  filmcraft: VideoFilmcraftSchema.nullable().default(null),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type VideoProject = z.infer<typeof VideoProjectSchema>;

/** Programmi esterni usati dal main di Electron. */
export const VIDEO_TOOLS = [
  'ffmpeg',
  'ffprobe',
  'whisper',
  'whisperModel',
  'tts',
  'ttsVoice',
  'filmcraft',
] as const;
export type VideoTool = (typeof VIDEO_TOOLS)[number];

export const VIDEO_TOOL_LABELS: Record<VideoTool, string> = {
  ffmpeg: 'FFmpeg',
  ffprobe: 'ffprobe',
  whisper: 'whisper.cpp',
  whisperModel: 'Modello Whisper',
  tts: 'sherpa-onnx (voce)',
  ttsVoice: 'Voce Piper',
  filmcraft: 'FilmCraft',
};

export const ToolStatusSchema = z.object({
  tool: z.enum(VIDEO_TOOLS),
  /** Percorso trovato o impostato; null se assente. */
  path: z.string().nullable(),
  /** `impostato` a mano nelle Impostazioni, `rilevato` cercando nel PATH e nelle cartelle note. */
  source: z.enum(['impostato', 'rilevato', 'assente']),
  /** Prima riga della versione (programmi), dimensione (modello) o nome della voce. */
  detail: z.string().nullable(),
  /** Il percorso impostato esiste ma non funziona. */
  error: z.string().nullable(),
});
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export const ToolsStatusSchema = z.array(ToolStatusSchema);
export type ToolsStatus = z.infer<typeof ToolsStatusSchema>;

/** Durata come «1:05:03» o «4:12». */
export function formatDurationMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** Avanzamento di un lavoro lungo sul video, inviato dal main al renderer. */
export const VIDEO_JOB_STAGES = [
  'audio',
  'trascrizione',
  'render',
  'filmcraft',
  'voce',
  'slide',
  'montaggio',
] as const;
export type VideoJobStage = (typeof VIDEO_JOB_STAGES)[number];

export const VIDEO_JOB_STAGE_LABELS: Record<VideoJobStage, string> = {
  audio: 'Estraggo l’audio',
  trascrizione: 'Trascrivo con Whisper',
  render: 'Esporto il video con FFmpeg',
  filmcraft: 'Esporto da FilmCraft',
  voce: 'Leggo il copione con la voce',
  slide: 'Disegno le slide',
  montaggio: 'Monto slide e voce',
};

export interface VideoJobProgress {
  projectId: string;
  stage: VideoJobStage;
  /** 0–100; null se non si può stimare. */
  percent: number | null;
}

/**
 * Ciò che determina il video esportato, in forma stabile: sorgente, tagli, formato, ritaglio,
 * stile e parole dei sottotitoli. Il main ne calcola lo sha256 per sapere se il file è superato.
 */
export function videoRenderKey(
  project: Pick<VideoProject, 'source' | 'edit' | 'transcript'>,
): string {
  return JSON.stringify({
    source: [project.source.path, project.source.sizeBytes, project.source.durationMs],
    edit: project.edit,
    words: (project.transcript?.words ?? []).map((w) => [w.text, w.startMs, w.endMs]),
  });
}
