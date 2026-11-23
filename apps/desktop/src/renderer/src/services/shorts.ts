import {
  SHORT_PLATFORMS,
  formatDurationMs,
  shortSegments,
  type GenerateShortsRequest,
  type GeneratedShort,
  type VideoProject,
} from '@prisma-app/shared';
import type { VideoTarget } from './video';

/**
 * Richiesta di «Genera Short» per un progetto trascritto: le frasi parlate con i tempi del
 * sorgente (non quelli del montaggio, perché lo Short riparte dal video intero). Null senza
 * trascrizione o senza parlato.
 */
export function shortsRequest(
  project: VideoProject,
  brandId: number,
): GenerateShortsRequest | null {
  if (!project.transcript) return null;
  const segments = shortSegments(project.transcript.words, project.source.durationMs);
  if (segments.length === 0) return null;
  return {
    brandId,
    videoTitle: project.title,
    durationMs: project.source.durationMs,
    segments,
    platforms: [...SHORT_PLATFORMS],
  };
}

/** Avviso dopo la generazione, come nel mockup: orari d'inizio e dove trovare le bozze. */
export function shortsToast(shorts: readonly Pick<GeneratedShort, 'startMs'>[]): string {
  if (shorts.length === 0) return 'Nessun momento adatto a uno Short.';
  const times = shorts.map((s) => formatDurationMs(s.startMs)).join(', ');
  const found = shorts.length === 1 ? 'Trovato 1 momento' : `Trovati ${shorts.length} momenti`;
  return `${found} per gli Short: ${times}. Li trovi nello Studio e tra i video, pronti da rivedere.`;
}

/** Per un progetto Short la bozza da collegare è quella del suo contenuto: si propone la prima. */
export function suggestedTarget(
  project: Pick<VideoProject, 'short'>,
  targets: readonly VideoTarget[],
): VideoTarget | null {
  if (!project.short) return null;
  return targets.find((t) => t.content.id === project.short!.contentId) ?? null;
}
