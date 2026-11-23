import {
  PLATFORM_LABELS,
  VIDEO_JOB_STAGE_LABELS,
  VIDEO_VARIANT_FORMAT,
  VIDEO_TOOL_LABELS,
  editedDurationMs,
  formatDurationMs,
  transcriptSegments,
  type Content,
  type ToolsStatus,
  type Transcript,
  type Variant,
  type VideoJobProgress,
  type VideoProject,
  type VideoTool,
} from '@prisma-app/shared';

/** Il video usa FFmpeg e Whisper sul computer: nel browser non è disponibile. */
export function canUseVideo(): boolean {
  return typeof window !== 'undefined' && Boolean(window.prisma?.video);
}

/** Indirizzo del video servito dal main (solo progetti registrati). */
export function mediaUrl(projectId: string): string {
  return `prisma-media://video/${projectId}`;
}

const RATIOS: Array<[number, string]> = [
  [16 / 9, '16:9'],
  [9 / 16, '9:16'],
  [1, '1:1'],
  [4 / 5, '4:5'],
  [4 / 3, '4:3'],
  [3 / 4, '3:4'],
  [21 / 9, '21:9'],
];

/** «1920×1080 · 16:9»; le proporzioni insolite restano solo come dimensioni. */
export function resolutionLabel(width: number, height: number): string {
  const ratio = width / height;
  const match = RATIOS.find(([value]) => Math.abs(value - ratio) < 0.02);
  return match ? `${width}×${height} · ${match[1]}` : `${width}×${height}`;
}

export function fpsLabel(fps: number): string {
  return `${Number.isInteger(fps) ? fps : fps.toLocaleString('it-IT', { maximumFractionDigits: 2 })} fps`;
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toLocaleString('it-IT', { maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** Cosa serve per ogni funzione: importare (ffprobe), trascrivere (whisper e modello), montare (ffmpeg). */
export const TOOL_NEEDS: Record<'import' | 'transcribe' | 'render' | 'filmcraft', VideoTool[]> = {
  import: ['ffprobe'],
  transcribe: ['ffmpeg', 'whisper', 'whisperModel'],
  render: ['ffmpeg'],
  filmcraft: ['filmcraft', 'ffprobe'],
};

/** Strumenti mancanti o non funzionanti, tra quelli che servono a una funzione. */
export function missingTools(status: ToolsStatus, needs: readonly VideoTool[]): string[] {
  return needs
    .filter((tool) => {
      const entry = status.find((s) => s.tool === tool);
      return !entry?.path || entry.error;
    })
    .map((tool) => VIDEO_TOOL_LABELS[tool]);
}

/** Come installare ciascuno strumento (Windows), mostrato nelle Impostazioni. */
export const TOOL_HINTS: Record<VideoTool, string> = {
  ffmpeg: 'winget install Gyan.FFmpeg (installa anche ffprobe)',
  ffprobe: 'Arriva insieme a FFmpeg',
  whisper: 'Zip della release di whisper.cpp per Windows: contiene whisper-cli.exe',
  whisperModel:
    'File ggml-small.bin di whisper.cpp nella cartella whisper-models dei dati di Prisma, o scegli il file',
  filmcraft:
    'Facoltativo, per rifinire il montaggio: installa FilmCraft dal launcher di ArtCraft (filmcraft.exe con filmcraft-cli.exe accanto)',
};

/** Sotto questa probabilità una parola è «incerta»: da ricontrollare nella trascrizione. */
export const LOW_CONFIDENCE = 0.5;

export interface TranscriptSummary {
  words: number;
  sentences: number;
  silences: number;
  /** Durata totale dei silenzi, già formattata («1:12»). */
  silenceLabel: string;
  uncertain: number;
}

export function transcriptSummary(transcript: Transcript, durationMs: number): TranscriptSummary {
  const segments = transcriptSegments(transcript.words, durationMs);
  const silences = segments.filter((s) => s.kind === 'silence');
  const silenceMs = silences.reduce((total, s) => total + (s.endMs - s.startMs), 0);
  return {
    words: transcript.words.length,
    sentences: segments.length - silences.length,
    silences: silences.length,
    silenceLabel: formatDurationMs(silenceMs),
    uncertain: transcript.words.filter((w) => w.p < LOW_CONFIDENCE).length,
  };
}

/** «Trascrivo con Whisper · 45%». */
export function progressLabel(progress: VideoJobProgress | null): string {
  if (!progress) return 'Avvio…';
  const stage = VIDEO_JOB_STAGE_LABELS[progress.stage];
  return progress.percent === null ? stage : `${stage} · ${progress.percent}%`;
}

/** Bozza a cui collegare il video esportato. */
export interface VideoTarget {
  content: Content;
  variant: Variant;
  label: string;
}

/** Variant delle piattaforme che pubblicano video (YouTube, TikTok, Reel, LinkedIn), più recenti prima. */
export function videoTargets(contents: readonly Content[]): VideoTarget[] {
  return contents.flatMap((content) =>
    content.variants
      .filter((variant) => variant.platform in VIDEO_VARIANT_FORMAT)
      .map((variant) => ({
        content,
        variant,
        label: `${content.title} · ${PLATFORM_LABELS[variant.platform]}`,
      })),
  );
}

/** Riga sotto il titolo nell'elenco: per uno Short la durata del momento e il formato verticale. */
export function projectListMeta(project: VideoProject): string {
  if (project.short) {
    return `Short · ${formatDurationMs(editedDurationMs(project.edit.cuts, project.source.durationMs))} · 9:16`;
  }
  return `${formatDurationMs(project.source.durationMs)} · ${resolutionLabel(project.source.width, project.source.height)}`;
}
