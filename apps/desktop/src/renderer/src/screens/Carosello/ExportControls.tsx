import { EXPORT_FORMATS, type ExportFormat, type Platform } from '@prisma-app/shared';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '../../components/Button/Button';
import {
  showExportedFile,
  useStorageStatus,
  useUploadAssets,
  useVariantAssets,
} from '../../hooks/useExport';
import { errorMessage } from '../../services/api/client';
import {
  EXPORT_LABELS,
  canExportHere,
  exportSummaries,
  pendingUploads,
} from '../../services/exports';
import styles from './Carosello.module.css';

type Exporter = UseMutationResult<unknown, Error, ExportFormat>;

/** Il formato che serve alla piattaforma della variant è il pulsante principale. */
function primaryFormat(platform: Platform): ExportFormat {
  return platform === 'linkedin' ? 'pdf' : 'jpg';
}

interface ExportButtonsProps {
  exporter: Exporter;
  platform: Platform;
  /** Motivo per cui l'export non è possibile ora (modifiche da salvare, browser…). */
  blockedReason: string | null;
}

/** «Esporta JPG» ed «Esporta PDF» nell'intestazione dell'editor (V3Carosello). */
export function ExportButtons({ exporter, platform, blockedReason }: ExportButtonsProps) {
  const primary = primaryFormat(platform);
  return (
    <>
      {EXPORT_FORMATS.map((format) => {
        const busy = exporter.isPending && exporter.variables === format;
        return (
          <button
            key={format}
            type="button"
            className={`${styles.exportButton} ${format === primary ? styles.exportPrimary : ''}`}
            disabled={Boolean(blockedReason) || exporter.isPending}
            title={blockedReason ?? undefined}
            onClick={() => exporter.mutate(format)}
          >
            <span className={styles.exportTitle}>
              {busy ? 'Esporto…' : `Esporta ${EXPORT_LABELS[format].title}`}
            </span>
            <span className={styles.exportHint}>{EXPORT_LABELS[format].target}</span>
          </button>
        );
      })}
    </>
  );
}

/** Stato dei file esportati: quanti, se sono aggiornati, se sono su R2, dove trovarli. */
export function ExportPanel({ exporter, variantId }: { exporter: Exporter; variantId: number }) {
  const assets = useVariantAssets(variantId);
  const storage = useStorageStatus().data;
  const upload = useUploadAssets(variantId);
  const summaries = exportSummaries(assets.data ?? []);
  const pending = pendingUploads(assets.data ?? []);
  const desktop = canExportHere();
  const busy = exporter.isPending || upload.isPending;

  return (
    <section aria-labelledby="h-export" className={styles.panel}>
      <h2 id="h-export" className={styles.panelTitle}>
        File esportati
      </h2>
      {summaries.length === 0 && (
        <p className={styles.note}>
          Nessun export ancora: i file si salvano sul computer e si caricano su R2 per la
          pubblicazione.
        </p>
      )}
      {summaries.map((summary) => (
        <div key={summary.format} className={styles.exportRow}>
          <span className={styles.exportLabel}>{summary.label}</span>
          <span className={styles.exportState} data-stale={summary.upToDate ? undefined : true}>
            {!summary.upToDate
              ? 'slide cambiate: esporta di nuovo'
              : summary.uploaded
                ? 'aggiornato · su R2'
                : 'aggiornato · solo sul computer'}
          </span>
          {desktop && summary.firstPath && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => void showExportedFile(summary.firstPath!)}
            >
              Apri cartella
            </button>
          )}
        </div>
      ))}
      {desktop && storage?.configured && pending.length > 0 && (
        <Button
          variant="secondary"
          size={32}
          disabled={busy}
          onClick={() => upload.mutate(assets.data ?? [])}
        >
          {upload.isPending ? 'Carico…' : `Carica su R2 (${pending.length})`}
        </Button>
      )}
      {storage && !storage.configured && summaries.length > 0 && (
        <p className={styles.note}>
          R2 non è configurato sul server: i file restano sul computer e non si possono pubblicare.
        </p>
      )}
      {!desktop && (
        <p className={styles.note}>L’export funziona nell’app desktop, non nel browser.</p>
      )}
      {exporter.error || upload.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(exporter.error ?? upload.error)}
        </p>
      ) : null}
    </section>
  );
}
