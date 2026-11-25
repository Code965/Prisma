import { z } from 'zod';
import type { TranscriptWord } from './transcript.js';
import { DEFAULT_VIDEO_AUDIO, LEGACY_VIDEO_AUDIO, VideoAudioSchema } from './video-audio.js';
import { BROLL_LIMITS, BrollSchema, OVERLAY_LIMITS, OverlaySchema } from './video-overlays.js';

/**
 * Modifiche di un progetto video (editor del passo 3c): parti tagliate, formato con posizione
 * del ritaglio e stile dei sottotitoli. Il file sorgente non si tocca mai: il render (3d)
 * applica queste modifiche con FFmpeg. Funzioni pure, usate da editor e render.
 */

export const VIDEO_FORMATS = ['9:16', '1:1', '16:9'] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const VIDEO_FORMAT_INFO: Record<
  VideoFormat,
  { width: number; height: number; label: string; note: string }
> = {
  '9:16': {
    width: 1080,
    height: 1920,
    label: '9:16 · 1080×1920',
    note: 'Reel, TikTok, Short · trascina il riquadro per riposizionarlo',
  },
  '1:1': {
    width: 1080,
    height: 1080,
    label: '1:1 · 1080×1080',
    note: 'Post quadrato · trascina il riquadro per riposizionarlo',
  },
  '16:9': {
    width: 1920,
    height: 1080,
    label: '16:9 · 1920×1080',
    note: 'YouTube e LinkedIn · nessun ritaglio',
  },
};

export const SUBTITLE_STYLES = ['clean', 'word', 'box', 'big'] as const;
export type SubtitleStyle = (typeof SUBTITLE_STYLES)[number];

export const SUBTITLE_STYLE_LABELS: Record<SubtitleStyle, string> = {
  clean: 'Pulito',
  word: 'Parola per parola',
  box: 'Riquadro scuro',
  big: 'Grande al centro',
};

export const TimeRangeSchema = z
  .object({ startMs: z.int().nonnegative(), endMs: z.int().nonnegative() })
  .refine((r) => r.endMs > r.startMs, 'Intervallo vuoto');
export type TimeRange = z.infer<typeof TimeRangeSchema>;

/** Zoom (fase 6a) in tempo del sorgente: il riquadro del formato ingrandito di `scale`. */
export const ZOOM_LIMITS = { min: 1, max: 1.5 } as const;
export const ZoomSchema = z
  .object({
    startMs: z.int().nonnegative(),
    endMs: z.int().nonnegative(),
    scale: z.number().min(ZOOM_LIMITS.min).max(ZOOM_LIMITS.max),
  })
  .refine((r) => r.endMs > r.startMs, 'Intervallo vuoto');
export type Zoom = z.infer<typeof ZoomSchema>;

/** Titolo grande nei primi secondi del video montato (l'«hook»). */
export const HookSchema = z.object({
  text: z.string().trim().min(1).max(80),
  durationMs: z.int().min(1000).max(6000),
});
export type Hook = z.infer<typeof HookSchema>;

export const VideoEditSchema = z.object({
  cuts: z.array(TimeRangeSchema).max(5000),
  format: z.enum(VIDEO_FORMATS),
  /** Posizione del ritaglio lungo l'asse libero (0 = sinistra/alto, 1 = destra/basso). */
  cropOffset: z.number().min(0).max(1),
  subtitles: z.enum(SUBTITLE_STYLES),
  /** Ingrandimenti (punch-in ai tagli, enfasi sulle frasi importanti). Assente nei progetti vecchi. */
  zooms: z.array(ZoomSchema).max(5000).default([]),
  /** Parole chiave evidenziate nei sottotitoli, indicate dall'istante d'inizio della parola. */
  keywords: z.array(z.int().nonnegative()).max(5000).default([]),
  hook: HookSchema.nullable().default(null),
  /** Voce ripulita, volume uniforme e musica (6b). */
  audio: VideoAudioSchema.default(LEGACY_VIDEO_AUDIO),
  /** Schede di testo in sovrimpressione (6d). */
  overlays: z.array(OverlaySchema).max(OVERLAY_LIMITS.max).default([]),
  /** Spezzoni o immagini che coprono il video mentre la voce continua (6d). */
  broll: z.array(BrollSchema).max(BROLL_LIMITS.max).default([]),
  /** Il ritaglio segue il volto (6e) invece di restare a `cropOffset`; serve `project.faces`. */
  followFace: z.boolean().default(false),
  /** Come comporre webcam e schermo registrati insieme (6f); senza schermo resta «Solo tu». */
  layout: z.enum(['camera', 'screen', 'pip', 'split']).default('camera'),
});
export type VideoEdit = z.infer<typeof VideoEditSchema>;

export const DEFAULT_VIDEO_EDIT: VideoEdit = {
  cuts: [],
  format: '9:16',
  cropOffset: 0.5,
  subtitles: 'word',
  zooms: [],
  keywords: [],
  hook: null,
  audio: DEFAULT_VIDEO_AUDIO,
  overlays: [],
  broll: [],
  followFace: false,
  layout: 'camera',
};

// --- Tagli -----------------------------------------------------------------------------------

/** Ordina e fonde gli intervalli che si toccano o si sovrappongono. */
export function normalizeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.endMs > r.startMs)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
    else merged.push(range);
  }
  return merged;
}

export function addCut(cuts: readonly TimeRange[], range: TimeRange): TimeRange[] {
  return normalizeRanges([...cuts, range]);
}

/** Toglie un intervallo dai tagli (anche a metà di un taglio più lungo). */
export function removeCut(cuts: readonly TimeRange[], range: TimeRange): TimeRange[] {
  const result: TimeRange[] = [];
  for (const cut of normalizeRanges(cuts)) {
    if (cut.endMs <= range.startMs || cut.startMs >= range.endMs) {
      result.push(cut);
      continue;
    }
    if (cut.startMs < range.startMs) result.push({ startMs: cut.startMs, endMs: range.startMs });
    if (cut.endMs > range.endMs) result.push({ startMs: range.endMs, endMs: cut.endMs });
  }
  return result;
}

/** L'intervallo è interamente tagliato. */
export function isCut(cuts: readonly TimeRange[], range: TimeRange): boolean {
  return normalizeRanges(cuts).some((c) => c.startMs <= range.startMs && c.endMs >= range.endMs);
}

export function toggleCut(cuts: readonly TimeRange[], range: TimeRange): TimeRange[] {
  return isCut(cuts, range) ? removeCut(cuts, range) : addCut(cuts, range);
}

/** Parti che restano nel video, in ordine. */
export function keptRanges(cuts: readonly TimeRange[], durationMs: number): TimeRange[] {
  const kept: TimeRange[] = [];
  let at = 0;
  for (const cut of normalizeRanges(cuts)) {
    if (cut.startMs > at) kept.push({ startMs: at, endMs: Math.min(cut.startMs, durationMs) });
    at = Math.max(at, cut.endMs);
  }
  if (at < durationMs) kept.push({ startMs: at, endMs: durationMs });
  return kept.filter((r) => r.endMs > r.startMs);
}

export function editedDurationMs(cuts: readonly TimeRange[], durationMs: number): number {
  return keptRanges(cuts, durationMs).reduce((total, r) => total + (r.endMs - r.startMs), 0);
}

export function cutDurationMs(cuts: readonly TimeRange[], durationMs: number): number {
  return durationMs - editedDurationMs(cuts, durationMs);
}

/**
 * Durante l'anteprima: se la posizione cade in un taglio, il punto da cui riprendere (la fine
 * del taglio); altrimenti la posizione stessa.
 */
export function skipCuts(cuts: readonly TimeRange[], ms: number): number {
  for (const cut of normalizeRanges(cuts)) {
    if (ms >= cut.startMs && ms < cut.endMs) return cut.endMs;
  }
  return ms;
}

/** Tempo del video montato corrispondente a un istante del sorgente. */
export function editedTimeMs(cuts: readonly TimeRange[], sourceMs: number): number {
  let removed = 0;
  for (const cut of normalizeRanges(cuts)) {
    if (cut.startMs >= sourceMs) break;
    removed += Math.min(cut.endMs, sourceMs) - cut.startMs;
  }
  return Math.max(0, sourceMs - removed);
}

// --- Zoom ----------------------------------------------------------------------------------

/** Ingrandimento a un istante del sorgente (1 = nessuno); con zoom sovrapposti vince il più forte. */
export function zoomAt(zooms: readonly Zoom[], ms: number): number {
  return zooms.reduce(
    (scale, z) => (ms >= z.startMs && ms < z.endMs ? Math.max(scale, z.scale) : scale),
    1,
  );
}

/**
 * Le parti rimaste divise dove cambia lo zoom: il render applica a ciascuna un ingrandimento
 * fisso («punch-in», lo stile dei creator).
 */
export function zoomedParts(
  kept: readonly TimeRange[],
  zooms: readonly Zoom[],
): Array<TimeRange & { scale: number }> {
  const parts: Array<TimeRange & { scale: number }> = [];
  for (const range of kept) {
    const bounds = new Set([range.startMs, range.endMs]);
    for (const z of zooms) {
      if (z.startMs > range.startMs && z.startMs < range.endMs) bounds.add(z.startMs);
      if (z.endMs > range.startMs && z.endMs < range.endMs) bounds.add(z.endMs);
    }
    const points = [...bounds].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const startMs = points[i]!;
      const endMs = points[i + 1]!;
      const scale = zoomAt(zooms, startMs);
      const last = parts[parts.length - 1];
      // Parti contigue con lo stesso zoom restano una sola.
      if (last && last.endMs === startMs && last.scale === scale) last.endMs = endMs;
      else parts.push({ startMs, endMs, scale });
    }
  }
  return parts;
}

/** La parola è una parola chiave da evidenziare. */
export function isKeyword(keywords: readonly number[], word: TranscriptWord): boolean {
  return keywords.includes(word.startMs);
}

// --- Ritaglio --------------------------------------------------------------------------------

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Riquadro del formato scelto dentro il sorgente, in pixel del sorgente: il più grande con le
 * proporzioni del formato, spostato lungo l'asse libero secondo `cropOffset`.
 */
export function cropRect(
  format: VideoFormat,
  sourceWidth: number,
  sourceHeight: number,
  cropOffset: number,
): CropRect {
  return cropRectForAspect(formatAspect(format), sourceWidth, sourceHeight, cropOffset);
}

/** Larghezza / altezza del formato. */
export function formatAspect(format: VideoFormat): number {
  const { width, height } = VIDEO_FORMAT_INFO[format];
  return width / height;
}

/**
 * Ritaglio del sorgente con le proporzioni `target` (larghezza / altezza), spostato di
 * `cropOffset` lungo l'asse libero. Serve anche per i riquadri dei layout (6f), che non hanno le
 * proporzioni del formato (es. metà inferiore di un 9:16).
 */
export function cropRectForAspect(
  target: number,
  sourceWidth: number,
  sourceHeight: number,
  cropOffset: number,
): CropRect {
  const source = sourceWidth / sourceHeight;
  const offset = Math.min(1, Math.max(0, cropOffset));
  if (source > target) {
    const width = Math.round(sourceHeight * target);
    return { x: Math.round((sourceWidth - width) * offset), y: 0, width, height: sourceHeight };
  }
  const height = Math.round(sourceWidth / target);
  return { x: 0, y: Math.round((sourceHeight - height) * offset), width: sourceWidth, height };
}

/** Dimensione pari (yuv420p non accetta dispari). */
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/**
 * Riquadro di una parte con zoom: il ritaglio del formato rimpicciolito di `scale`, centrato.
 * Poi la scala lo riporta alle dimensioni del video: l'effetto è un ingrandimento («punch-in»).
 */
export function zoomedCrop(crop: CropRect, scale: number): CropRect {
  if (scale <= 1) return crop;
  const width = even(crop.width / scale);
  const height = even(crop.height / scale);
  return {
    x: crop.x + Math.round((crop.width - width) / 2),
    y: crop.y + Math.round((crop.height - height) / 2),
    width,
    height,
  };
}

// --- Sottotitoli -----------------------------------------------------------------------------

export interface Caption {
  startMs: number;
  endMs: number;
  words: TranscriptWord[];
}

/**
 * Didascalie dalle parole rimaste dopo i tagli: righe di al massimo `maxChars` caratteri,
 * spezzate anche alla fine delle frasi e nelle pause, perché non restino a video troppo a lungo.
 */
export function buildCaptions(
  words: readonly TranscriptWord[],
  cuts: readonly TimeRange[],
  maxChars = 32,
  maxPauseMs = 700,
): Caption[] {
  const kept = words.filter(
    (w) => !isCut(cuts, { startMs: w.startMs, endMs: Math.max(w.endMs, w.startMs + 1) }),
  );
  const captions: Caption[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (current.length > 0) {
      captions.push({
        startMs: current[0]!.startMs,
        endMs: current[current.length - 1]!.endMs,
        words: current,
      });
    }
    current = [];
  };
  for (const word of kept) {
    const last = current[current.length - 1];
    const length = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    if (last && (length > maxChars || word.startMs - last.endMs > maxPauseMs)) flush();
    current.push(word);
    if (/[.!?…]$/.test(word.text)) flush();
  }
  flush();
  return captions;
}

/** Didascalia visibile a un istante e indice della parola pronunciata (per lo stile «parola per parola»). */
export function captionAt(
  captions: readonly Caption[],
  ms: number,
): { caption: Caption; activeWord: number } | null {
  const caption = captions.find((c) => ms >= c.startMs && ms <= c.endMs);
  if (!caption) return null;
  let activeWord = 0;
  caption.words.forEach((w, i) => {
    if (ms >= w.startMs) activeWord = i;
  });
  return { caption, activeWord };
}
