import {
  OVERLAY_LIMITS,
  bestStockItem,
  filenameScore,
  overlayId,
  type Broll,
  type BrollMedia,
  type BrollRequest,
  type EnrichRequest,
  type Overlay,
  type OverlayKind,
  type StockItem,
  type VideoEdit,
  type VideoFormat,
  type VideoProject,
} from '@prisma-app/shared';
import { autoEditRequest } from './auto-edit';

/**
 * «Aggiungi B-roll e testi» (fase 6d): il server propone schede e ricerche; il B-roll si cerca
 * prima nella cartella dell'utente (per nome del file), poi su Pixabay se c'è la chiave.
 */

/** Stessa richiesta di «Monta con l'AI»: le frasi parlate; null senza trascrizione. */
export function enrichRequest(project: VideoProject, brandId: number): EnrichRequest | null {
  return autoEditRequest(project, brandId);
}

export function formatOrientation(format: VideoFormat): 'vertical' | 'horizontal' | 'square' {
  return format === '9:16' ? 'vertical' : format === '16:9' ? 'horizontal' : 'square';
}

/** Il file della cartella che risponde meglio alla ricerca: prima i video lunghi abbastanza. */
export function pickFolderMedia(
  items: readonly BrollMedia[],
  query: string,
  needMs: number,
): BrollMedia | null {
  const scored = items
    .map((media) => ({ media, score: filenameScore(media.fileName, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      const usable = (m: BrollMedia) => (m.kind === 'image' || m.durationMs >= needMs ? 1 : 0);
      return b.score - a.score || usable(b.media) - usable(a.media);
    });
  return scored[0]?.media ?? null;
}

/** Il risultato di Pixabay da scaricare per una ricerca (video, se no foto). */
export function pickStockItem(
  videos: readonly StockItem[],
  images: readonly StockItem[],
  needMs: number,
  format: VideoFormat,
): StockItem | null {
  const orientation = formatOrientation(format);
  return bestStockItem(videos, needMs, orientation) ?? bestStockItem(images, needMs, orientation);
}

export function newBroll(request: BrollRequest, media: BrollMedia, index: number): Broll {
  return {
    id: overlayId('broll', request.startMs, index),
    startMs: request.startMs,
    endMs: request.endMs,
    media,
    query: request.query,
  };
}

/** Scheda aggiunta a mano all'istante del player. */
export function newOverlay(kind: OverlayKind, sourceMs: number, durationMs: number): Overlay {
  const startMs = Math.max(0, Math.min(Math.round(sourceMs), durationMs - OVERLAY_LIMITS.minMs));
  const length = kind === 'title' ? OVERLAY_LIMITS.titleMs : 5000;
  return {
    id: overlayId(`${kind}-mano`, startMs, Date.now() % 100_000),
    kind,
    startMs,
    endMs: Math.min(durationMs, startMs + length),
    title: kind === 'title' ? 'Nuovo titolo' : kind === 'code' ? 'Codice' : 'Punti',
    body: kind === 'list' ? 'Primo punto\nSecondo punto' : '',
    code: kind === 'code' ? 'codice()' : '',
  };
}

export interface EnrichSummary {
  overlays: number;
  fromFolder: number;
  fromPixabay: number;
  /** Ricerche senza risultato (o senza archivio configurato). */
  missing: number;
  /** Nessuna chiave di Pixabay: le ricerche non trovate nella cartella restano senza B-roll. */
  stockOff: boolean;
}

/** Le schede e il B-roll proposti sostituiscono quelli di prima (l'AI li rifà tutti). */
export function withEnrichment(edit: VideoEdit, overlays: Overlay[], broll: Broll[]): VideoEdit {
  return { ...edit, overlays, broll };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function enrichToast(summary: EnrichSummary): string {
  const found = summary.fromFolder + summary.fromPixabay;
  const parts = [
    summary.overlays > 0
      ? plural(summary.overlays, 'scheda di testo', 'schede di testo')
      : 'Nessuna scheda',
    found > 0
      ? `${plural(found, 'B-roll', 'B-roll')} (${[
          summary.fromFolder ? `${summary.fromFolder} dalla tua cartella` : null,
          summary.fromPixabay ? `${summary.fromPixabay} da Pixabay` : null,
        ]
          .filter(Boolean)
          .join(', ')})`
      : 'nessun B-roll',
  ];
  const missing =
    summary.missing > 0
      ? summary.stockOff
        ? ` ${plural(summary.missing, 'ricerca', 'ricerche')} senza file: aggiungi la chiave di Pixabay nelle Impostazioni o file con nomi adatti nella cartella del B-roll.`
        : ` ${plural(summary.missing, 'ricerca', 'ricerche')} senza risultati.`
      : '';
  return `${parts.join(' · ')}.${missing} Controlla prima di esportare.`;
}
