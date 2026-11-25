import { z } from 'zod';
import { InstantSchema } from './common.js';
import { VIDEO_FORMAT_INFO, type VideoFormat } from './video-edit.js';

/**
 * Registrazione nell'app e layout (fase 6f). La webcam (con il microfono) è il sorgente del
 * progetto; lo schermo registrato insieme è una seconda traccia, sincronizzata con `offsetMs`.
 * Nell'editor si sceglie come comporle: solo tu, solo lo schermo, lo schermo con te in un
 * riquadro, oppure (in 9:16) diviso con lo schermo sopra e te sotto.
 */

export const VIDEO_LAYOUTS = ['camera', 'screen', 'pip', 'split'] as const;
export type VideoLayout = (typeof VIDEO_LAYOUTS)[number];

export const VIDEO_LAYOUT_LABELS: Record<VideoLayout, string> = {
  camera: 'Solo tu',
  screen: 'Solo schermo',
  pip: 'Schermo e te nell’angolo',
  split: 'Diviso: schermo sopra, tu sotto',
};

/** Schermo registrato insieme alla webcam. */
export const VideoScreenSchema = z.object({
  path: z.string().min(1),
  fileName: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  durationMs: z.int().nonnegative(),
  /** Inizio dello schermo rispetto alla webcam: positivo = lo schermo è partito dopo. */
  offsetMs: z.int(),
});
export type VideoScreen = z.infer<typeof VideoScreenSchema>;

/** Registrazione fatta in Prisma: quando e cosa c'era. */
export const VideoRecordingSchema = z.object({
  recordedAt: InstantSchema,
  camera: z.boolean(),
  screen: z.boolean(),
});
export type VideoRecording = z.infer<typeof VideoRecordingSchema>;

/** Layout che hanno senso: senza schermo solo «Solo tu»; il diviso solo in verticale. */
export function availableLayouts(format: VideoFormat, hasScreen: boolean): VideoLayout[] {
  if (!hasScreen) return ['camera'];
  return format === '9:16' ? ['camera', 'screen', 'pip', 'split'] : ['camera', 'screen', 'pip'];
}

/** Il layout davvero usato (uno non disponibile torna a «Solo tu»). */
export function effectiveLayout(
  layout: VideoLayout,
  format: VideoFormat,
  hasScreen: boolean,
): VideoLayout {
  return availableLayouts(format, hasScreen).includes(layout) ? layout : 'camera';
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/**
 * Riquadri del layout nel video finale (pixel): dove va la webcam e dove lo schermo. Il
 * riquadro della webcam nell'angolo è quadrato, in alto a destra (in basso ci sono i sottotitoli).
 */
export function layoutBoxes(
  layout: VideoLayout,
  format: VideoFormat,
): { camera: Box | null; screen: Box | null } {
  const { width: W, height: H } = VIDEO_FORMAT_INFO[format];
  const full: Box = { x: 0, y: 0, width: W, height: H };
  switch (layout) {
    case 'camera':
      return { camera: full, screen: null };
    case 'screen':
      return { camera: null, screen: full };
    case 'pip': {
      const size = even(Math.min(W, H) * 0.34);
      const margin = even(Math.min(W, H) * 0.04);
      return {
        camera: { x: W - size - margin, y: margin, width: size, height: size },
        screen: full,
      };
    }
    case 'split': {
      const half = even(H / 2);
      return {
        screen: { x: 0, y: 0, width: W, height: half },
        camera: { x: 0, y: half, width: W, height: H - half },
      };
    }
  }
}

/** Istante dello schermo per un istante della webcam (sorgente), dentro la durata dello schermo. */
export function screenTimeMs(screen: VideoScreen, sourceMs: number): number {
  return Math.min(Math.max(0, sourceMs - screen.offsetMs), screen.durationMs);
}
