import { VIDEO_FORMAT_INFO, formatDurationMs, type VideoProject } from '@prisma-app/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { useAttachVideo } from '../../hooks/useAttachVideo';
import { useContents } from '../../hooks/useCalendar';
import { showExportedFile, useStorageStatus } from '../../hooks/useExport';
import { useRenderStatus, useRenderVideo, useToolsStatus } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import { suggestedTarget } from '../../services/shorts';
import {
  TOOL_NEEDS,
  missingTools,
  progressLabel,
  sizeLabel,
  videoTargets,
} from '../../services/video';
import styles from './VideoEditor.module.css';

/**
 * «Video finale»: esporta con FFmpeg le modifiche dell'editor, poi collega il file a una bozza
 * (che torna in revisione) e lo carica su R2 per la pubblicazione.
 */
export function ExportVideoPanel({ project, dirty }: { project: VideoProject; dirty: boolean }) {
  const tools = useToolsStatus();
  const { start, progress, cancel } = useRenderVideo(project.id);
  const status = useRenderStatus(project);
  const storage = useStorageStatus().data;
  const contents = useContents();
  const attach = useAttachVideo(project);
  // undefined = nessuna scelta: per uno Short si propone la bozza del suo contenuto.
  const [targetId, setTargetId] = useState<number | null | undefined>(undefined);
  const missing = tools.data ? missingTools(tools.data, TOOL_NEEDS.render) : [];
  const targets = videoTargets(contents.data ?? []);
  const target =
    targetId === undefined
      ? suggestedTarget(project, targets)
      : (targets.find((t) => t.variant.id === targetId) ?? null);
  const render = project.render;
  const upToDate = status.data?.upToDate ?? false;

  return (
    <section aria-labelledby="h-finale" className={styles.finalPanel}>
      <div className={styles.timelineHead}>
        <h2 id="h-finale" className={styles.timelineTitle}>
          Video finale
        </h2>
        <span className={`${styles.asideMeta} mono`}>
          {VIDEO_FORMAT_INFO[project.edit.format].label} · H.264 + AAC
        </span>
      </div>

      {start.isPending ? (
        <div className={styles.finalRow}>
          <span className={styles.finalLabel}>{progressLabel(progress)}</span>
          <progress
            className={styles.finalProgress}
            max={100}
            value={progress?.percent ?? undefined}
          />
          <Button variant="secondary" size={32} onClick={cancel}>
            Annulla
          </Button>
        </div>
      ) : (
        <div className={styles.finalRow}>
          <Button
            size={36}
            disabled={missing.length > 0 || dirty}
            title={
              missing.length
                ? `Serve ${missing.join(', ')}`
                : dirty
                  ? 'Attendi il salvataggio delle modifiche'
                  : undefined
            }
            onClick={() => start.mutate()}
          >
            {render ? 'Esporta di nuovo' : 'Esporta video'}
          </Button>
          {render && (
            <span className={styles.finalInfo}>
              <span className="mono">
                {formatDurationMs(render.durationMs)} · {sizeLabel(render.sizeBytes)}
                {render.origin === 'filmcraft' ? ' · da FilmCraft' : ''}
              </span>
              <span className={styles.finalState} data-stale={upToDate ? undefined : true}>
                {upToDate ? 'aggiornato' : 'modifiche dopo l’export: esporta di nuovo'}
              </span>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => void showExportedFile(render.path)}
              >
                Apri cartella
              </button>
            </span>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <p className={styles.hint}>
          Per esportare serve {missing.join(', ')} (<Link to="/impostazioni">Impostazioni</Link> ›
          Strumenti video).
        </p>
      )}
      {start.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(start.error)}
        </p>
      ) : null}

      {render && upToDate && (
        <div className={styles.finalRow}>
          <label className={styles.finalTarget}>
            <span className={styles.asideMeta}>Collega a</span>
            <select
              className={styles.select}
              value={target?.variant.id ?? ''}
              onChange={(event) =>
                setTargetId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">Scegli una bozza (YouTube, TikTok, Reel, LinkedIn)…</option>
              {targets.map((t) => (
                <option key={t.variant.id} value={t.variant.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size={36}
            disabled={!target || attach.isPending}
            onClick={() => target && attach.mutate(target)}
          >
            {attach.isPending
              ? storage?.configured
                ? 'Collego e carico…'
                : 'Collego…'
              : storage?.configured
                ? 'Collega e carica su R2'
                : 'Collega'}
          </Button>
        </div>
      )}
      {attach.isSuccess && (
        <p className={styles.hint}>
          Collegato a «{attach.data.target.label}»: la bozza è tornata in revisione.{' '}
          {attach.data.assets.some((a) => a.kind === 'video' && a.remoteKey)
            ? 'Video caricato su R2.'
            : 'R2 non configurato: il video resta sul computer.'}{' '}
          <Link to={`/studio/${attach.data.target.content.id}`}>Apri nello Studio</Link>
        </p>
      )}
      {attach.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(attach.error)}
        </p>
      ) : null}
    </section>
  );
}
