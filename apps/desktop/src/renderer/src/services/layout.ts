import {
  VIDEO_FORMAT_INFO,
  availableLayouts,
  cropRectForAspect,
  effectiveLayout,
  formatAspect,
  layoutBoxes,
  zoomedCrop,
  type Box,
  type CropRect,
  type VideoEdit,
  type VideoLayout,
  type VideoProject,
} from '@prisma-app/shared';

/**
 * Layout di webcam e schermo nell'editor (fase 6f): quali si possono scegliere e come disegnarli
 * nell'anteprima, con gli stessi riquadri e ritagli del render.
 */

export function layoutChoices(project: VideoProject, edit: VideoEdit): VideoLayout[] {
  return availableLayouts(edit.format, project.screen !== null);
}

export function currentLayout(project: VideoProject, edit: VideoEdit): VideoLayout {
  return effectiveLayout(edit.layout, edit.format, project.screen !== null);
}

/** Proporzioni del riquadro della webcam nel layout (quelle del formato con «Solo tu»). */
export function cameraBoxAspect(project: VideoProject, edit: VideoEdit): number {
  const box = layoutBoxes(currentLayout(project, edit), edit.format).camera;
  return box ? box.width / box.height : formatAspect(edit.format);
}

/** Ritaglio della webcam per l'anteprima: proporzioni del suo riquadro, posizione e zoom. */
export function cameraCrop(
  project: VideoProject,
  edit: VideoEdit,
  offset: number,
  zoom: number,
): CropRect {
  const rect = cropRectForAspect(
    cameraBoxAspect(project, edit),
    project.source.width,
    project.source.height,
    offset,
  );
  return zoomedCrop(rect, zoom);
}

/** Lo schermo intero dentro il suo riquadro (come `pad` nel render): posizione e misure. */
export function fitInside(
  box: Box,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(box.width / width, box.height / height);
  const w = width * scale;
  const h = height * scale;
  return { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };
}

/** Riquadri del layout in pixel del canvas dell'anteprima (largo `canvasWidth`). */
export function previewBoxes(edit: VideoEdit, layout: VideoLayout, canvasWidth: number) {
  const { width } = VIDEO_FORMAT_INFO[edit.format];
  const k = canvasWidth / width;
  const scale = (box: Box | null) =>
    box && { x: box.x * k, y: box.y * k, width: box.width * k, height: box.height * k };
  const boxes = layoutBoxes(layout, edit.format);
  return { camera: scale(boxes.camera), screen: scale(boxes.screen) };
}
