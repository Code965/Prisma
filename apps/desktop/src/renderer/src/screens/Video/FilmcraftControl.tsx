import type { VideoProject } from '@prisma-app/shared';
import { useFilmcraft, useFilmcraftStatus, useToolsStatus } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import { filmcraftView } from '../../services/filmcraft';
import { TOOL_NEEDS, missingTools, progressLabel } from '../../services/video';
import styles from './VideoEditor.module.css';

const TONE_COLOR = {
  muted: 'var(--muted)',
  review: 'var(--s-review)',
  ok: 'var(--s-ok)',
  pub: 'var(--s-pub)',
} as const;

const REBUILD_CONFIRM =
  'Ricreare il progetto FilmCraft dal montaggio di Prisma? Le modifiche fatte in FilmCraft andranno perse.';

/**
 * Pulsante FilmCraft dell'editor (sperimentale): apre il montaggio in FilmCraft, ne fa esportare
 * il video e lo riporta in Prisma, con lo stato di sincronizzazione del mockup.
 */
export function FilmcraftControl({ project, dirty }: { project: VideoProject; dirty: boolean }) {
  const tools = useToolsStatus();
  const status = useFilmcraftStatus(project);
  const { open, exportReturn, useReturn, progress, cancel } = useFilmcraft(project.id);
  const missing = tools.data ? missingTools(tools.data, TOOL_NEEDS.filmcraft) : [];
  const view = filmcraftView(project, {
    installed: tools.data !== undefined && missing.length === 0,
    connected: status.data?.connected ?? false,
  });
  const busy = open.isPending || exportReturn.isPending || useReturn.isPending;
  const error = open.error ?? exportReturn.error ?? useReturn.error;

  function run() {
    if (view.button.action === 'open') open.mutate(false);
    if (view.button.action === 'export') exportReturn.mutate();
    if (view.button.action === 'use') useReturn.mutate();
  }

  const title = missing.length
    ? `Serve ${missing.join(', ')} (Impostazioni › Strumenti video)`
    : dirty && view.button.action === 'open'
      ? 'Attendi il salvataggio delle modifiche'
      : undefined;

  return (
    <div className={styles.filmcraftGroup}>
      <div className={styles.filmcraft}>
        <button
          type="button"
          className={styles.filmcraftButton}
          disabled={!view.button.action || busy || (dirty && view.button.action === 'open')}
          title={title}
          aria-busy={busy}
          onClick={run}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 3h7v7" />
            <path d="M10 14L21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
          {open.isPending ? 'Preparo il progetto…' : view.button.label}
        </button>
        <span
          className={styles.filmcraftStatus}
          style={{ color: TONE_COLOR[exportReturn.isPending ? 'review' : view.status.tone] }}
          role="status"
        >
          <span className={styles.dot} />
          {exportReturn.isPending ? progressLabel(progress) : view.status.text}
        </span>
      </div>
      {exportReturn.isPending && (
        <button type="button" className={styles.linkButton} onClick={cancel}>
          Annulla
        </button>
      )}
      {!busy && view.canReopen && (
        <button type="button" className={styles.linkButton} onClick={() => open.mutate(false)}>
          Riapri in FilmCraft
        </button>
      )}
      {!busy && status.data?.stale && (
        <button
          type="button"
          className={styles.linkButton}
          title="Hai cambiato il montaggio in Prisma dopo l’apertura in FilmCraft"
          onClick={() => window.confirm(REBUILD_CONFIRM) && open.mutate(true)}
        >
          Ricrea dal montaggio di Prisma
        </button>
      )}
      {error ? (
        <p role="alert" className={styles.filmcraftError}>
          {errorMessage(error)}
        </p>
      ) : null}
    </div>
  );
}
