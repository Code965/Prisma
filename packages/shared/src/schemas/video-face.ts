import { z } from 'zod';
import { InstantSchema } from './common.js';
import { VIDEO_FORMAT_INFO, type VideoFormat } from './video-edit.js';

/**
 * Inquadratura che segue il volto (fase 6e). Il renderer trova il volto con MediaPipe in
 * fotogrammi campionati (`FaceTrack`, salvato nel progetto); da lì `followPath` calcola un
 * percorso morbido della posizione del ritaglio: la «camera» si muove solo quando il volto esce
 * dalla zona centrale e scivola verso di lui senza scatti. Anteprima e render usano lo stesso
 * percorso (`followOffsetAt`).
 */

export const FACE_LIMITS = {
  /** Campioni al secondo: 4 fino a 3 minuti, poi 2 (l'analisi resta sotto un paio di minuti). */
  shortIntervalMs: 250,
  longIntervalMs: 500,
  longAfterMs: 180_000,
  maxSamples: 20_000,
  /** Zona centrale in cui il volto si può muovere senza spostare la camera (frazione del ritaglio). */
  deadZone: 0.12,
  /** Velocità massima della camera, in larghezze del ritaglio al secondo. */
  maxSpeed: 0.6,
  /** Errore ammesso togliendo i punti superflui del percorso (frazione della corsa). */
  simplifyTolerance: 0.004,
} as const;

/** Un volto trovato: centro e misure in frazioni del fotogramma sorgente (0–1). */
export const FaceSampleSchema = z.object({
  ms: z.int().nonnegative(),
  /** null = nessun volto in questo fotogramma. */
  x: z.number().min(0).max(1).nullable(),
  y: z.number().min(0).max(1).nullable(),
  size: z.number().min(0).max(1).nullable(),
});
export type FaceSample = z.infer<typeof FaceSampleSchema>;

export const FaceTrackSchema = z.object({
  intervalMs: z.int().positive(),
  samples: z.array(FaceSampleSchema).max(FACE_LIMITS.maxSamples),
  /** Fotogrammi con un volto, in frazione: sotto lo 0,3 l'analisi probabilmente non serve. */
  coverage: z.number().min(0).max(1),
  model: z.string().max(100),
  createdAt: InstantSchema,
});
export type FaceTrack = z.infer<typeof FaceTrackSchema>;

export function faceIntervalMs(durationMs: number): number {
  return durationMs > FACE_LIMITS.longAfterMs
    ? FACE_LIMITS.longIntervalMs
    : FACE_LIMITS.shortIntervalMs;
}

/** Istanti da analizzare. */
export function faceSampleTimes(durationMs: number): number[] {
  const step = faceIntervalMs(durationMs);
  const times: number[] = [];
  for (let ms = 0; ms < durationMs && times.length < FACE_LIMITS.maxSamples; ms += step)
    times.push(ms);
  return times;
}

/** Punto del percorso: istante del sorgente e posizione del ritaglio (0–1, come `cropOffset`). */
export interface FollowPoint {
  ms: number;
  offset: number;
}

/** L'asse su cui il ritaglio si può spostare per questo formato e questa sorgente; null se nessuno. */
export function freeAxis(
  format: VideoFormat | number,
  sourceWidth: number,
  sourceHeight: number,
): 'x' | 'y' | null {
  const target = aspectOf(format);
  const source = sourceWidth / sourceHeight;
  if (Math.abs(source - target) < 0.01) return null;
  return source > target ? 'x' : 'y';
}

/**
 * Percorso della camera morbida. La camera (centro del ritaglio, in frazioni della sorgente)
 * sta ferma finché il volto resta nella zona centrale; quando ne esce si muove verso il volto a
 * velocità limitata, con partenza e arrivo dolci, e si ferma quando lo ha di nuovo al centro.
 * Senza volto la camera resta dov'è. Il percorso è semplificato (pochi punti, interpolati).
 */
export function followPath(
  track: FaceTrack,
  format: VideoFormat | number,
  sourceWidth: number,
  sourceHeight: number,
  startOffset = 0.5,
): FollowPoint[] {
  const axis = freeAxis(format, sourceWidth, sourceHeight);
  if (!axis || track.samples.length === 0) return [];
  const aspect = aspectOf(format);
  // Ampiezza del ritaglio sull'asse libero, in frazioni della sorgente.
  const span =
    axis === 'x' ? (sourceHeight * aspect) / sourceWidth : sourceWidth / aspect / sourceHeight;
  const travel = 1 - span;
  const toCenter = (offset: number) => span / 2 + offset * travel;
  const toOffset = (center: number) => clamp01((center - span / 2) / travel);

  const deadZone = FACE_LIMITS.deadZone * span;
  let previousMs: number | null = null;
  let camera = toCenter(clamp01(startOffset));
  let velocity = 0;
  let moving = false;
  const raw: FollowPoint[] = [];
  for (const sample of track.samples) {
    // I campioni non sono per forza regolari (si prendono mentre il video scorre): conta il tempo vero.
    const dt =
      previousMs === null
        ? track.intervalMs / 1000
        : Math.max(0.01, (sample.ms - previousMs) / 1000);
    previousMs = sample.ms;
    const maxStep = FACE_LIMITS.maxSpeed * span * dt;
    const face = axis === 'x' ? sample.x : sample.y;
    if (face !== null) {
      const target = Math.min(1 - span / 2, Math.max(span / 2, face));
      const distance = target - camera;
      if (Math.abs(distance) > deadZone) moving = true;
      if (moving) {
        // Accelera verso il volto, rallenta in arrivo (velocità proporzionale alla distanza).
        const wanted = Math.max(-maxStep, Math.min(maxStep, distance * 0.35));
        velocity += (wanted - velocity) * 0.5;
        camera += velocity;
        if (Math.abs(target - camera) < deadZone * 0.15) {
          moving = false;
          velocity = 0;
        }
      }
    } else {
      velocity = 0;
      moving = false;
    }
    raw.push({ ms: sample.ms, offset: toOffset(camera) });
  }
  // Partenze e arrivi della camera restano: senza, la semplificazione la farebbe scivolare prima.
  const still = (i: number) => Math.abs(raw[i]!.offset - raw[i - 1]!.offset) < 1e-9;
  const fixed = new Set<number>();
  for (let i = 1; i < raw.length - 1; i++) {
    if (still(i) !== still(i + 1)) fixed.add(i);
  }
  return simplifyPath(raw, FACE_LIMITS.simplifyTolerance, fixed);
}

/** Toglie i punti che l'interpolazione lineare ricostruisce comunque (Ramer–Douglas–Peucker). */
export function simplifyPath(
  points: readonly FollowPoint[],
  tolerance: number,
  fixed: ReadonlySet<number> = new Set(),
): FollowPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  const anchors = [
    0,
    ...[...fixed].filter((i) => i > 0 && i < points.length - 1).sort((a, b) => a - b),
    points.length - 1,
  ];
  for (const i of anchors) keep[i] = true;
  const stack: Array<[number, number]> = anchors.slice(1).map((end, i) => [anchors[i]!, end]);
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = points[first]!;
    const b = points[last]!;
    let worst = -1;
    let worstError = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i]!;
      const ratio = (p.ms - a.ms) / Math.max(1, b.ms - a.ms);
      const error = Math.abs(p.offset - (a.offset + (b.offset - a.offset) * ratio));
      if (error > worstError) {
        worst = i;
        worstError = error;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Posizione del ritaglio in un istante (interpolazione lineare; prima e dopo il percorso resta ferma). */
export function followOffsetAt(path: readonly FollowPoint[], ms: number, fallback: number): number {
  if (path.length === 0) return fallback;
  if (ms <= path[0]!.ms) return path[0]!.offset;
  const last = path[path.length - 1]!;
  if (ms >= last.ms) return last.offset;
  let low = 0;
  let high = path.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (path[mid]!.ms <= ms) low = mid;
    else high = mid;
  }
  const a = path[low]!;
  const b = path[high]!;
  return a.offset + ((b.offset - a.offset) * (ms - a.ms)) / Math.max(1, b.ms - a.ms);
}

/** Punti del percorso dentro un intervallo, con i due estremi interpolati (per il render di una parte). */
export function followSegment(
  path: readonly FollowPoint[],
  startMs: number,
  endMs: number,
  fallback: number,
): FollowPoint[] {
  const inside = path.filter((p) => p.ms > startMs && p.ms < endMs);
  return [
    { ms: startMs, offset: followOffsetAt(path, startMs, fallback) },
    ...inside,
    { ms: endMs, offset: followOffsetAt(path, endMs, fallback) },
  ];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Proporzioni (larghezza / altezza) di un formato o di un riquadro qualsiasi (layout della 6f). */
function aspectOf(format: VideoFormat | number): number {
  if (typeof format === 'number') return format;
  const { width, height } = VIDEO_FORMAT_INFO[format];
  return width / height;
}
