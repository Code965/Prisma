import type { FaceTrack, VideoEdit, VideoProject } from '@prisma-app/shared';
import { DEFAULT_VIDEO_EDIT } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  bestFace,
  buildFaceTrack,
  canFollowFace,
  faceCoverageLabel,
  fetchableUrl,
  previewCropOffset,
  previewFollowPath,
} from './face';

const faces: FaceTrack = {
  intervalMs: 250,
  samples: Array.from({ length: 40 }, (_, i) => ({
    ms: i * 250,
    x: i < 10 ? 0.5 : 0.85,
    y: 0.4,
    size: 0.2,
  })),
  coverage: 1,
  model: 'blaze_face_short_range',
  createdAt: '2026-11-25T10:00:00.000Z',
};
const project = {
  id: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
  source: { width: 1920, height: 1080, durationMs: 10_000 },
  faces,
} as unknown as VideoProject;

describe('segui il volto', () => {
  it('sceglie il volto più grande tra quelli sicuri', () => {
    const face = bestFace(
      [
        { box: { x: 0, y: 0, width: 20, height: 20 }, score: 0.9 },
        { box: { x: 100, y: 40, width: 60, height: 60 }, score: 0.8 },
        { box: { x: 200, y: 0, width: 100, height: 100 }, score: 0.3 },
      ],
      320,
      180,
    );
    expect(face).toEqual({ x: 130 / 320, y: 70 / 180, size: 60 / 320 });
    expect(bestFace([], 320, 180)).toEqual({ x: null, y: null, size: null });
  });

  it('traccia con la copertura e l’etichetta', () => {
    const track = buildFaceTrack(
      [
        { ms: 0, x: 0.5, y: 0.5, size: 0.2 },
        { ms: 250, x: null, y: null, size: null },
      ],
      10_000,
      'blaze',
      new Date('2026-11-25T10:00:00Z'),
    );
    expect(track).toMatchObject({ intervalMs: 250, coverage: 0.5, model: 'blaze' });
    expect(faceCoverageLabel(track)).toBe('Volto trovato nel 50% del video');
    expect(faceCoverageLabel({ ...track, coverage: 0 })).toMatch(/Nessun volto/);
  });

  it('nell’anteprima il riquadro segue il percorso solo se acceso', () => {
    const off: VideoEdit = { ...DEFAULT_VIDEO_EDIT, cropOffset: 0.3 };
    expect(previewFollowPath(project, off)).toEqual([]);
    expect(previewCropOffset([], off, 5000)).toBe(0.3);
    const on: VideoEdit = { ...off, followFace: true, cropOffset: 0.5 };
    const path = previewFollowPath(project, on);
    expect(previewCropOffset(path, on, 9750)).toBeGreaterThan(0.8);
    expect(canFollowFace(project, '9:16')).toBe(true);
    expect(canFollowFace(project, '16:9')).toBe(false);
  });

  it('dalla build MediaPipe legge i file dal protocollo prisma-app', () => {
    expect(fetchableUrl('./assets/vision.wasm', 'file:///C:/app/out/renderer/index.html')).toBe(
      'prisma-app://assets/vision.wasm',
    );
    expect(fetchableUrl('/assets/m.tflite', 'http://localhost:5173/')).toBe(
      'http://localhost:5173/assets/m.tflite',
    );
  });
});
