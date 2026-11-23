import type { ExportFormat, VariantAsset } from '@prisma-app/shared';

/** L'export usa Electron (finestra nascosta e file su disco): nel browser non è disponibile. */
export function canExportHere(): boolean {
  return typeof window !== 'undefined' && Boolean(window.prisma?.exportCarousel);
}

export const EXPORT_LABELS: Record<ExportFormat, { title: string; target: string }> = {
  jpg: { title: 'JPG', target: 'Instagram · TikTok' },
  pdf: { title: 'PDF', target: 'LinkedIn' },
};

export interface ExportSummary {
  format: ExportFormat;
  label: string;
  upToDate: boolean;
  /** Tutti i file sono su R2 (verificati dal server). */
  uploaded: boolean;
  /** File da mostrare in Esplora risorse (il primo dell'export). */
  firstPath: string | null;
}

/** Riepilogo per formato dei file esportati collegati alla variant. */
export function exportSummaries(assets: readonly VariantAsset[]): ExportSummary[] {
  const summaries: ExportSummary[] = [];
  const images = assets.filter((a) => a.role === 'media' && a.kind === 'image');
  const pdfs = assets.filter((a) => a.role === 'media' && a.kind === 'pdf');
  if (images.length > 0) {
    summaries.push({
      format: 'jpg',
      label: `${images.length} ${images.length === 1 ? 'immagine' : 'immagini'} JPEG`,
      upToDate: images.every((a) => a.upToDate),
      uploaded: images.every((a) => a.remoteKey !== null),
      firstPath: images[0]!.localPath,
    });
  }
  if (pdfs.length > 0) {
    summaries.push({
      format: 'pdf',
      label: `PDF di ${formatSize(pdfs[0]!.sizeBytes)}`,
      upToDate: pdfs.every((a) => a.upToDate),
      uploaded: pdfs.every((a) => a.remoteKey !== null),
      firstPath: pdfs[0]!.localPath,
    });
  }
  return summaries;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
}

/** File aggiornati, salvati sul computer e non ancora su R2: quelli da caricare. */
export function pendingUploads(assets: readonly VariantAsset[]): VariantAsset[] {
  return assets.filter(
    (a) => a.role === 'media' && a.upToDate && a.remoteKey === null && a.localPath !== null,
  );
}
