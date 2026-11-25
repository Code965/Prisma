import { describe, expect, it } from 'vitest';
import { cropRect, cropRectForAspect, DEFAULT_VIDEO_EDIT } from './video-edit.js';
import { VideoProjectSchema, videoRenderKey } from './video.js';
import {
  availableLayouts,
  effectiveLayout,
  layoutBoxes,
  screenTimeMs,
  type VideoScreen,
} from './video-layout.js';

describe('layout di webcam e schermo', () => {
  it('senza schermo solo «Solo tu»; il diviso solo in 9:16', () => {
    expect(availableLayouts('9:16', false)).toEqual(['camera']);
    expect(availableLayouts('9:16', true)).toContain('split');
    expect(availableLayouts('16:9', true)).not.toContain('split');
    expect(effectiveLayout('split', '16:9', true)).toBe('camera');
    expect(effectiveLayout('pip', '9:16', false)).toBe('camera');
  });

  it('riquadri nel video finale', () => {
    expect(layoutBoxes('split', '9:16')).toEqual({
      screen: { x: 0, y: 0, width: 1080, height: 960 },
      camera: { x: 0, y: 960, width: 1080, height: 960 },
    });
    expect(layoutBoxes('pip', '9:16')).toEqual({
      screen: { x: 0, y: 0, width: 1080, height: 1920 },
      camera: { x: 1080 - 368 - 44, y: 44, width: 368, height: 368 },
    });
    expect(layoutBoxes('screen', '16:9').camera).toBeNull();
  });

  it('il ritaglio si adatta a proporzioni qualsiasi (metà del 9:16)', () => {
    expect(cropRectForAspect(1080 / 960, 1920, 1080, 0.5)).toEqual({
      x: 353,
      y: 0,
      width: 1215,
      height: 1080,
    });
    expect(cropRect('9:16', 1920, 1080, 0.5)).toEqual(
      cropRectForAspect(1080 / 1920, 1920, 1080, 0.5),
    );
  });

  it('tempo dello schermo dall’istante della webcam', () => {
    const screen: VideoScreen = {
      path: 's.mp4',
      fileName: 's.mp4',
      width: 1920,
      height: 1080,
      durationMs: 10_000,
      offsetMs: 300,
    };
    expect(screenTimeMs(screen, 1000)).toBe(700);
    expect(screenTimeMs(screen, 100)).toBe(0);
    expect(screenTimeMs(screen, 20_000)).toBe(10_000);
  });

  it('il layout entra nella chiave del render solo se usa lo schermo', () => {
    const at = '2026-11-25T10:00:00.000Z';
    const project = VideoProjectSchema.parse({
      id: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
      title: 't',
      source: {
        path: 'v.mp4',
        fileName: 'v.mp4',
        sizeBytes: 1,
        durationMs: 1000,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: 'h264',
        hasAudio: true,
      },
      createdAt: at,
      updatedAt: at,
    });
    expect(project.edit.layout).toBe('camera');
    expect(videoRenderKey(project)).not.toContain('layout');
    const withScreen = {
      ...project,
      screen: {
        path: 's.mp4',
        fileName: 's.mp4',
        width: 1920,
        height: 1080,
        durationMs: 1000,
        offsetMs: 0,
      },
      edit: { ...DEFAULT_VIDEO_EDIT, layout: 'split' as const },
    };
    expect(videoRenderKey(withScreen)).toContain('"screen"');
  });
});
