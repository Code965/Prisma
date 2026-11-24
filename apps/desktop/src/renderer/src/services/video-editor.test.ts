import { DEFAULT_VIDEO_EDIT, type VideoProject } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  clockLabel,
  cropOverlay,
  draggedOffset,
  editorSegments,
  removeSilences,
  rulerLabels,
  secondsLabel,
  sourceTimeMs,
} from './video-editor';

const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, p: 0.9 });

const project: VideoProject = {
  id: '8c1d4f3e-2a5b-4c6d-9e8f-0a1b2c3d4e5f',
  title: 'client-db',
  source: {
    path: 'C:\\v.mp4',
    fileName: 'v.mp4',
    sizeBytes: 1,
    durationMs: 10_000,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    hasAudio: true,
  },
  transcript: {
    language: 'it',
    model: 'ggml-small.bin',
    createdAt: '2026-11-22T12:00:00.000Z',
    words: [word('Allora,', 0, 400), word('vediamo.', 450, 900), word('Fine.', 4000, 4500)],
  },
  edit: DEFAULT_VIDEO_EDIT,
  render: null,
  short: null,
  generated: null,
  filmcraft: null,
  createdAt: '2026-11-22T12:00:00.000Z',
  updatedAt: '2026-11-22T12:00:00.000Z',
};

describe('segmenti dell’editor', () => {
  it('etichetta orari e durate come nel mockup e segna i tagli', () => {
    const segments = editorSegments(project, [{ startMs: 900, endMs: 4000 }]);
    expect(segments.map((s) => [s.kind, s.atLabel, s.durationLabel, s.cut])).toEqual([
      ['speech', '00:00', '0,9 s', false],
      ['silence', '00:01', '3,1 s', true],
      ['speech', '00:04', '0,5 s', false],
      ['silence', '00:05', '5,5 s', false],
    ]);
    expect(editorSegments({ ...project, transcript: null }, [])).toEqual([]);
  });

  it('rimuove i silenzi non ancora tagliati e dice quanto ha tolto', () => {
    const segments = editorSegments(project, [{ startMs: 900, endMs: 4000 }]);
    const result = removeSilences(
      { ...DEFAULT_VIDEO_EDIT, cuts: [{ startMs: 900, endMs: 4000 }] },
      segments,
    );
    expect(result.count).toBe(1);
    expect(result.removedMs).toBe(5500);
    expect(result.edit.cuts).toEqual([
      { startMs: 900, endMs: 4000 },
      { startMs: 4500, endMs: 10_000 },
    ]);
  });
});

describe('tempi, ritaglio e timeline', () => {
  it('converte il tempo del video montato in quello del sorgente', () => {
    const cuts = [{ startMs: 1000, endMs: 2000 }];
    expect(sourceTimeMs(cuts, 500, 8000)).toBe(500);
    expect(sourceTimeMs(cuts, 1500, 8000)).toBe(2500);
    expect(sourceTimeMs(cuts, 99_000, 8000)).toBe(8000);
  });

  it('disegna il riquadro in percentuale e lo sposta trascinando', () => {
    const overlay = cropOverlay('9:16', 1920, 1080, 0.5);
    expect(overlay.width).toBeCloseTo(31.67, 1);
    expect(overlay.left).toBeCloseTo(34.17, 1);
    expect(cropOverlay('16:9', 1920, 1080, 0.5)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    const moved = draggedOffset({
      startOffset: 0.5,
      deltaX: 100,
      deltaY: 0,
      frameWidth: 960,
      frameHeight: 540,
      overlay,
    });
    expect(moved).toBeCloseTo(0.5 + 100 / (960 * (1 - overlay.width / 100)), 5);
    expect(
      draggedOffset({
        startOffset: 0.9,
        deltaX: 9999,
        deltaY: 0,
        frameWidth: 960,
        frameHeight: 540,
        overlay,
      }),
    ).toBe(1);
  });

  it('scrive orari, secondi e righello', () => {
    expect(clockLabel(252_000)).toBe('04:12');
    expect(clockLabel(3_903_000)).toBe('1:05:03');
    expect(secondsLabel(4200)).toBe('4,2 s');
    expect(rulerLabels(36_000)).toEqual(['00:00', '00:09', '00:18', '00:27', '00:36']);
  });
});
