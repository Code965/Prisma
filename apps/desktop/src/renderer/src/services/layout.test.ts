import { DEFAULT_VIDEO_EDIT, type VideoEdit, type VideoProject } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  cameraBoxAspect,
  cameraCrop,
  currentLayout,
  fitInside,
  layoutChoices,
  previewBoxes,
} from './layout';

const project = {
  source: { width: 1920, height: 1080 },
  screen: {
    path: 's.mp4',
    fileName: 's.mp4',
    width: 2560,
    height: 1440,
    durationMs: 1000,
    offsetMs: 0,
  },
} as unknown as VideoProject;
const split: VideoEdit = { ...DEFAULT_VIDEO_EDIT, layout: 'split' };

describe('layout nell’anteprima', () => {
  it('scelte e layout usato', () => {
    expect(layoutChoices(project, split)).toEqual(['camera', 'screen', 'pip', 'split']);
    expect(currentLayout({ ...project, screen: null }, split)).toBe('camera');
    expect(currentLayout(project, { ...split, format: '16:9' })).toBe('camera');
  });

  it('la webcam si ritaglia con le proporzioni del suo riquadro', () => {
    expect(cameraBoxAspect(project, split)).toBeCloseTo(1080 / 960);
    expect(cameraCrop(project, split, 0.5, 1)).toEqual({ x: 353, y: 0, width: 1215, height: 1080 });
    expect(cameraBoxAspect(project, DEFAULT_VIDEO_EDIT)).toBeCloseTo(1080 / 1920);
  });

  it('lo schermo entra intero nel suo riquadro', () => {
    expect(fitInside({ x: 0, y: 0, width: 1080, height: 960 }, 2560, 1440)).toEqual({
      x: 0,
      y: (960 - 607.5) / 2,
      width: 1080,
      height: 607.5,
    });
    const boxes = previewBoxes(split, 'split', 270);
    expect(boxes.screen).toEqual({ x: 0, y: 0, width: 270, height: 240 });
    expect(boxes.camera).toEqual({ x: 0, y: 240, width: 270, height: 240 });
  });
});
