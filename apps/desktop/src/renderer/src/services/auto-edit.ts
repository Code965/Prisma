import {
  autoEditSegments,
  type AutoEditRequest,
  type AutoEditSummary,
  type VideoProject,
} from '@prisma-app/shared';
import { secondsLabel } from './video-editor';

/** Richiesta per «Monta con l'AI»: le frasi parlate della trascrizione; null senza trascrizione. */
export function autoEditRequest(project: VideoProject, brandId: number): AutoEditRequest | null {
  if (!project.transcript) return null;
  const segments = autoEditSegments(project.transcript.words, project.source.durationMs).map(
    ({ startMs, endMs, text }) => ({ startMs, endMs, text }),
  );
  if (segments.length === 0) return null;
  return {
    brandId,
    videoTitle: project.title,
    durationMs: project.source.durationMs,
    segments,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Riepilogo di quello che «Monta con l'AI» ha fatto, per l'avviso nell'editor. */
export function autoEditToast(summary: AutoEditSummary): string {
  const cuts = [
    summary.silences ? plural(summary.silences, 'silenzio', 'silenzi') : null,
    summary.hesitations ? plural(summary.hesitations, 'esitazione', 'esitazioni') : null,
    summary.fillers ? plural(summary.fillers, 'riempitivo', 'riempitivi') : null,
    summary.removedSegments ? plural(summary.removedSegments, 'frase', 'frasi') : null,
  ].filter(Boolean);
  const parts = [
    cuts.length > 0
      ? `Tolti ${cuts.join(', ')} (−${secondsLabel(summary.removedMs)})`
      : 'Nessun taglio da fare',
    summary.hook ? 'titolo d’apertura' : null,
    summary.keywords ? plural(summary.keywords, 'parola chiave', 'parole chiave') : null,
    summary.zooms ? plural(summary.zooms, 'zoom', 'zoom') : null,
  ].filter(Boolean);
  return `${parts.join(' · ')}. Controlla e cambia quello che vuoi prima di esportare.`;
}

/** Riquadro del formato ristretto dallo zoom attivo (in percentuali del video), per l'anteprima. */
export function zoomedOverlay(
  overlay: { left: number; top: number; width: number; height: number },
  scale: number,
): { left: number; top: number; width: number; height: number } {
  if (scale <= 1) return overlay;
  const width = overlay.width / scale;
  const height = overlay.height / scale;
  return {
    left: overlay.left + (overlay.width - width) / 2,
    top: overlay.top + (overlay.height - height) / 2,
    width,
    height,
  };
}
