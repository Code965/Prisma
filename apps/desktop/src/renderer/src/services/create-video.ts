import {
  VIDEO_JOB_STAGE_LABELS,
  VIDEO_VARIANT_FORMAT,
  type CarouselTemplate,
  type Platform,
  type VideoJobProgress,
  type VideoProject,
  type VideoScriptRequest,
} from '@prisma-app/shared';

/**
 * «Crea video dall'idea» (fase 6c): il server scrive il copione, il main di Electron legge le
 * scene con la voce locale, disegna le slide del brand kit e monta un video 9:16 che si apre
 * nell'editor come un video importato.
 */

export type CreateVideoSource = { kind: 'idea' | 'variant'; id: number };

/** Template delle slide del video: come i caroselli, «Tech scuro» se la bozza non ne ha uno. */
export const DEFAULT_VIDEO_TEMPLATE: CarouselTemplate = 'scuro';

export function scriptRequest(source: CreateVideoSource): VideoScriptRequest {
  return source.kind === 'idea' ? { ideaId: source.id } : { variantId: source.id };
}

/** Dalle bozze delle piattaforme che pubblicano video (YouTube, TikTok, Instagram, LinkedIn). */
export function canCreateVideoFrom(platform: Platform): boolean {
  return platform in VIDEO_VARIANT_FORMAT;
}

/** «Scrivo il copione con l'AI» finché il server risponde, poi le fasi del main. */
export function createVideoLabel(progress: VideoJobProgress | null): string {
  if (!progress) return 'Scrivo il copione con l’AI…';
  const stage = VIDEO_JOB_STAGE_LABELS[progress.stage];
  return progress.percent === null ? `${stage}…` : `${stage} · ${progress.percent}%`;
}

/** «Creato dall'idea · 6 scene · Voce Piper it_IT-paola-medium». */
export function generatedLabel(project: VideoProject): string | null {
  const generated = project.generated;
  if (!generated) return null;
  const from = generated.source === 'idea' ? 'Creato dall’idea' : 'Creato dal post';
  return `${from} · ${generated.scenes} scene · ${generated.voice}`;
}
