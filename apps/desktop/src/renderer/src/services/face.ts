import {
  faceIntervalMs,
  followOffsetAt,
  followPath,
  freeAxis,
  type FaceSample,
  type FaceTrack,
  type FollowPoint,
  type VideoEdit,
  type VideoProject,
} from '@prisma-app/shared';

/**
 * Inquadratura che segue il volto (fase 6e), parte pura: quale volto seguire in un fotogramma,
 * la traccia da salvare e la posizione del ritaglio nell'anteprima.
 */

/** Rilevamento come lo dà MediaPipe: riquadro in pixel dell'immagine analizzata e punteggio. */
export interface Detection {
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

/**
 * Il volto da seguire: il più grande tra quelli abbastanza sicuri (chi parla di solito è il più
 * vicino), con centro e lato in frazioni del fotogramma.
 */
export function bestFace(
  detections: readonly Detection[],
  width: number,
  height: number,
  minScore = 0.5,
): Pick<FaceSample, 'x' | 'y' | 'size'> {
  const best = detections
    .filter((d) => d.score >= minScore)
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
  if (!best) return { x: null, y: null, size: null };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp((best.box.x + best.box.width / 2) / width),
    y: clamp((best.box.y + best.box.height / 2) / height),
    size: clamp(best.box.width / width),
  };
}

/** Traccia da salvare nel progetto, con la frazione di fotogrammi in cui c'è un volto. */
export function buildFaceTrack(
  samples: FaceSample[],
  durationMs: number,
  model: string,
  now: Date = new Date(),
): FaceTrack {
  const found = samples.filter((s) => s.x !== null).length;
  return {
    intervalMs: faceIntervalMs(durationMs),
    samples,
    coverage: samples.length === 0 ? 0 : found / samples.length,
    model,
    createdAt: now.toISOString(),
  };
}

/** Il formato scelto lascia spazio per spostare il ritaglio (altrimenti seguire il volto non serve). */
export function canFollowFace(project: VideoProject, format: VideoEdit['format']): boolean {
  return freeAxis(format, project.source.width, project.source.height) !== null;
}

/** Percorso del ritaglio per l'anteprima; vuoto se non si segue il volto. */
export function previewFollowPath(project: VideoProject, edit: VideoEdit): FollowPoint[] {
  if (!edit.followFace || !project.faces) return [];
  return followPath(
    project.faces,
    edit.format,
    project.source.width,
    project.source.height,
    edit.cropOffset,
  );
}

/** Posizione del ritaglio nell'anteprima: quella del percorso o quella scelta a mano. */
export function previewCropOffset(
  path: readonly FollowPoint[],
  edit: VideoEdit,
  sourceMs: number,
): number {
  return path.length > 0 ? followOffsetAt(path, sourceMs, edit.cropOffset) : edit.cropOffset;
}

/** «Volto trovato nell'87% del video». */
export function faceCoverageLabel(track: FaceTrack): string {
  const percent = Math.round(track.coverage * 100);
  if (percent === 0) return 'Nessun volto trovato: l’inquadratura resta dove l’hai messa';
  return `Volto trovato nel ${percent}% del video`;
}

/** Indirizzo da cui MediaPipe può fare `fetch` del file. */
export function fetchableUrl(url: string, base: string = location.href): string {
  const absolute = new URL(url, base);
  if (absolute.protocol !== 'file:') return absolute.href;
  return `prisma-app://assets/${absolute.pathname.split('/').pop()}`;
}
