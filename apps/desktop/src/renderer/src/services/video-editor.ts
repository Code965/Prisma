import {
  addCut,
  cropRect,
  formatDurationMs,
  isCut,
  normalizeRanges,
  transcriptSegments,
  type TimeRange,
  type TranscriptSegment,
  type VideoEdit,
  type VideoFormat,
  type VideoProject,
} from '@prisma-app/shared';

/** Segmento della colonna «Trascrizione» con lo stato del taglio. */
export interface EditorSegment {
  key: string;
  kind: TranscriptSegment['kind'];
  startMs: number;
  endMs: number;
  text: string;
  cut: boolean;
  /** «00:04» come nel mockup. */
  atLabel: string;
  /** «4,2 s». */
  durationLabel: string;
}

export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

/** Orario «mm:ss» (o «h:mm:ss») con lo zero davanti ai minuti, come nel mockup. */
export function clockLabel(ms: number): string {
  const label = formatDurationMs(ms);
  return label.length === 4 ? `0${label}` : label;
}

export function editorSegments(project: VideoProject, cuts: readonly TimeRange[]): EditorSegment[] {
  if (!project.transcript) return [];
  return transcriptSegments(project.transcript.words, project.source.durationMs).map((segment) => ({
    key: `${segment.kind}-${segment.startMs}`,
    kind: segment.kind,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.kind === 'speech' ? segment.text : '',
    cut: isCut(cuts, segment),
    atLabel: clockLabel(segment.startMs),
    durationLabel: secondsLabel(segment.endMs - segment.startMs),
  }));
}

/** «Rimuovi silenzi»: taglia tutti i silenzi non ancora tagliati. */
export function removeSilences(
  edit: VideoEdit,
  segments: readonly EditorSegment[],
): { edit: VideoEdit; count: number; removedMs: number } {
  const silences = segments.filter((s) => s.kind === 'silence' && !s.cut);
  const cuts = silences.reduce<TimeRange[]>((acc, s) => addCut(acc, s), [...edit.cuts]);
  return {
    edit: { ...edit, cuts },
    count: silences.length,
    removedMs: silences.reduce((total, s) => total + (s.endMs - s.startMs), 0),
  };
}

/** Istante del sorgente corrispondente a un tempo del video montato (per la barra di avanzamento). */
export function sourceTimeMs(
  cuts: readonly TimeRange[],
  editedMs: number,
  durationMs: number,
): number {
  let remaining = Math.max(0, editedMs);
  let at = 0;
  for (const cut of normalizeRanges(cuts)) {
    const kept = cut.startMs - at;
    if (remaining <= kept) return at + remaining;
    remaining -= Math.max(0, kept);
    at = Math.max(at, cut.endMs);
  }
  return Math.min(durationMs, at + remaining);
}

/** Riquadro di ritaglio in percentuale dell'immagine del sorgente, per disegnarlo sopra il player. */
export function cropOverlay(
  format: VideoFormat,
  sourceWidth: number,
  sourceHeight: number,
  cropOffset: number,
): { left: number; top: number; width: number; height: number } {
  const rect = cropRect(format, sourceWidth, sourceHeight, cropOffset);
  return {
    left: (rect.x / sourceWidth) * 100,
    top: (rect.y / sourceHeight) * 100,
    width: (rect.width / sourceWidth) * 100,
    height: (rect.height / sourceHeight) * 100,
  };
}

/**
 * Nuova posizione del ritaglio dopo un trascinamento: lo spostamento in pixel diviso per lo
 * spazio libero lungo l'asse in cui il riquadro si muove.
 */
export function draggedOffset(options: {
  startOffset: number;
  deltaX: number;
  deltaY: number;
  frameWidth: number;
  frameHeight: number;
  overlay: { width: number; height: number };
}): number {
  const horizontal = options.overlay.width < 100;
  const free = horizontal
    ? options.frameWidth * (1 - options.overlay.width / 100)
    : options.frameHeight * (1 - options.overlay.height / 100);
  if (free <= 0) return options.startOffset;
  const delta = horizontal ? options.deltaX : options.deltaY;
  return Math.min(1, Math.max(0, options.startOffset + delta / free));
}

/** Etichette del righello della timeline: `count` tacche distribuite sulla durata. */
export function rulerLabels(durationMs: number, count = 5): string[] {
  return Array.from({ length: count }, (_, i) => clockLabel((durationMs * i) / (count - 1)));
}
