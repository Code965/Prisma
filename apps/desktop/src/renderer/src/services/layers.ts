import { OVERLAY_KIND_LABELS, type Broll, type Overlay } from '@prisma-app/shared';
import { secondsLabel } from './video-editor';

/**
 * Schede di testo e B-roll nell'editor (fase 6d): anteprima, timeline e pannello. I tempi sono
 * del sorgente, come nella timeline.
 */

/** Punto dello spezzone per un istante del sorgente: ricomincia se è più corto (come nel render). */
export function brollPreviewSeconds(broll: Broll, sourceMs: number): number {
  const elapsed = Math.max(0, sourceMs - broll.startMs);
  const length = broll.media.durationMs;
  return (length > 0 ? elapsed % length : elapsed) / 1000;
}

/** Blocco della traccia «Testi e overlay»: posizione e larghezza in % del sorgente (come la timeline). */
export interface LayerBlock {
  id: string;
  kind: 'overlay' | 'broll';
  label: string;
  left: number;
  width: number;
}

export function layerBlocks(
  overlays: readonly Overlay[],
  broll: readonly Broll[],
  durationMs: number,
): LayerBlock[] {
  if (durationMs <= 0) return [];
  const block = (
    item: { id: string; startMs: number; endMs: number },
    kind: LayerBlock['kind'],
    label: string,
  ): LayerBlock[] => {
    const start = Math.min(item.startMs, durationMs);
    const end = Math.min(item.endMs, durationMs);
    if (end <= start) return [];
    return [
      {
        id: item.id,
        kind,
        label,
        left: (start / durationMs) * 100,
        width: ((end - start) / durationMs) * 100,
      },
    ];
  };
  return [
    ...broll.flatMap((b) => block(b, 'broll', `B-roll: ${b.query || b.media.fileName}`)),
    ...overlays.flatMap((o) =>
      block(
        o,
        'overlay',
        `${OVERLAY_KIND_LABELS[o.kind]}: ${o.kind === 'code' ? firstLine(o.code) || o.title : o.title}`,
      ),
    ),
  ];
}

const firstLine = (text: string) => text.split('\n')[0]?.trim() ?? '';

/** «0:12 · 3,5 s» per l'elenco del pannello. */
export function rangeLabel(item: { startMs: number; endMs: number }): string {
  const total = Math.floor(item.startMs / 1000);
  const start = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return `${start} · ${secondsLabel(item.endMs - item.startMs)}`;
}

/** Sostituisce un elemento per id. */
export function replaceById<T extends { id: string }>(list: readonly T[], next: T): T[] {
  return list.map((item) => (item.id === next.id ? next : item));
}

export function removeById<T extends { id: string }>(list: readonly T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

/** Pagina della documentazione di Pixabay, dove chi ha un account vede la sua chiave. */
export const PIXABAY_KEY_PAGE = 'https://pixabay.com/api/docs/';

/** «8 file», «Nessun file», «Cartella non trovata», «Non scelta». */
export function brollFolderLabel(
  status: { dir: string | null; items: readonly unknown[]; error: string | null } | null,
): string {
  if (!status?.dir) return 'Non scelta';
  if (status.error) return status.error;
  const count = status.items.length;
  return count === 0 ? 'Nessun file' : count === 1 ? '1 file' : `${count} file`;
}
