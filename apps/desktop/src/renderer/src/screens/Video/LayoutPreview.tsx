import { screenTimeMs, type VideoEdit, type VideoProject } from '@prisma-app/shared';
import { useEffect, useRef, type RefObject } from 'react';
import { cameraCrop, currentLayout, fitInside, previewBoxes } from '../../services/layout';
import { screenUrl } from '../../services/video';
import styles from './VideoEditor.module.css';

interface LayoutPreviewProps {
  project: VideoProject;
  edit: VideoEdit;
  /** Il player della webcam (sorgente). */
  camera: RefObject<HTMLVideoElement | null>;
  offset: number;
  zoom: number;
  sourceMs: number;
  playing: boolean;
}

/**
 * Anteprima del layout (6f): a ogni fotogramma disegna su un canvas lo schermo (intero, con le
 * bande) e la webcam ritagliata nel suo riquadro, come farà il render. Copre il riquadro del
 * formato del player.
 */
export function LayoutPreview({
  project,
  edit,
  camera,
  offset,
  zoom,
  sourceMs,
  playing,
}: LayoutPreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const screen = project.screen;
  const layout = currentLayout(project, edit);
  const state = useRef({ offset, zoom });
  // Posizione e zoom correnti per il disegno a ogni fotogramma (senza rifare il ciclo).
  useEffect(() => {
    state.current = { offset, zoom };
  }, [offset, zoom]);

  // Lo schermo segue il player della webcam (con la sua sfasatura).
  useEffect(() => {
    const element = screenVideo.current;
    if (!element || !screen) return;
    const target = screenTimeMs(screen, sourceMs) / 1000;
    if (Math.abs(element.currentTime - target) > 0.3) element.currentTime = target;
    if (playing && element.paused) void element.play().catch(() => {});
    if (!playing && !element.paused) element.pause();
  }, [screen, sourceMs, playing]);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const target = canvas.current;
      const context = target?.getContext('2d');
      if (target && context) {
        const width = target.clientWidth;
        const height = target.clientHeight;
        if (target.width !== width || target.height !== height) {
          target.width = width;
          target.height = height;
        }
        context.fillStyle = '#101318';
        context.fillRect(0, 0, width, height);
        const boxes = previewBoxes(edit, layout, width);
        const shown = screenVideo.current;
        if (boxes.screen && shown && shown.videoWidth > 0) {
          const fit = fitInside(boxes.screen, shown.videoWidth, shown.videoHeight);
          context.drawImage(shown, fit.x, fit.y, fit.width, fit.height);
        }
        const source = camera.current;
        if (boxes.camera && source && source.videoWidth > 0) {
          const crop = cameraCrop(project, edit, state.current.offset, state.current.zoom);
          context.drawImage(
            source,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            boxes.camera.x,
            boxes.camera.y,
            boxes.camera.width,
            boxes.camera.height,
          );
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [project, edit, layout, camera]);

  if (!screen) return null;
  return (
    <>
      <canvas ref={canvas} className={styles.layoutCanvas} aria-label="Anteprima del layout" />
      <video ref={screenVideo} src={screenUrl(project.id)} muted preload="auto" hidden />
    </>
  );
}
