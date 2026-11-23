import {
  editedDurationMs,
  formatDurationMs,
  type VideoEdit,
  type VideoProject,
} from '@prisma-app/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGenerateShorts, useSaveVideoEdit } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import { shortsToast } from '../../services/shorts';
import { editorSegments, removeSilences, secondsLabel } from '../../services/video-editor';
import { EditorTimeline } from './EditorTimeline';
import { ExportVideoPanel } from './ExportVideoPanel';
import { FilmcraftControl } from './FilmcraftControl';
import { PlayerPanel } from './PlayerPanel';
import { TranscriptAside } from './TranscriptAside';
import styles from './VideoEditor.module.css';

/** Attesa prima di salvare: i trascinamenti del ritaglio non scrivono a ogni pixel. */
const SAVE_DELAY_MS = 400;

/**
 * Editor video (V3Video): player con formato e sottotitoli, trascrizione che taglia, timeline.
 * Le modifiche vivono qui e si salvano da sole nel progetto (il file sorgente non cambia).
 */
export function VideoEditor({ project }: { project: VideoProject }) {
  const [edit, setEdit] = useState<VideoEdit>(project.edit);
  const [currentMs, setCurrentMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [seekTo, setSeekTo] = useState<{ ms: number } | null>(null);
  const save = useSaveVideoEdit(project.id);
  const shorts = useGenerateShorts(project);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => save.mutate(edit), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // `save` cambia identità a ogni render: si salva solo quando cambiano le modifiche.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);

  const segments = useMemo(() => editorSegments(project, edit.cuts), [project, edit.cuts]);
  const total = editedDurationMs(edit.cuts, project.source.durationMs);
  const dirty = save.isPending || JSON.stringify(edit) !== JSON.stringify(project.edit);

  function handleRemoveSilences() {
    const result = removeSilences(edit, segments);
    setEdit(result.edit);
    setToast(
      result.count > 0
        ? `Rimossi ${result.count} silenzi (−${secondsLabel(result.removedMs)}).`
        : 'Nessun silenzio da rimuovere.',
    );
  }

  function handleGenerateShorts() {
    setToast(null);
    shorts.mutate(undefined, { onSuccess: (result) => setToast(shortsToast(result.shorts)) });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <nav aria-label="Percorso" className={styles.breadcrumb}>
            <Link to="/video">Video</Link> / {project.title}
          </nav>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Editor video</h1>
            <span className={`${styles.subtitle} mono`}>
              {project.source.fileName} · durata {formatDurationMs(total)}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            disabled={!project.transcript}
            title={project.transcript ? undefined : 'Prima trascrivi il video'}
            onClick={handleRemoveSilences}
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
              <path d="M3 12h3l2-6 4 12 2-6h7" />
            </svg>
            Rimuovi silenzi
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={!shorts.available || shorts.isPending}
            title={shorts.available ? undefined : 'Prima trascrivi il video'}
            aria-busy={shorts.isPending}
            onClick={handleGenerateShorts}
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
              <rect x="7" y="2" width="10" height="20" rx="2" />
              <path d="M11 18h2" />
            </svg>
            {shorts.isPending ? 'Cerco i momenti migliori…' : 'Genera Short da video lungo'}
          </button>
          <FilmcraftControl project={project} dirty={dirty} />
        </div>
      </header>

      {toast && (
        <div role="status" className={styles.toast}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {toast}
        </div>
      )}
      {shorts.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(shorts.error)}
        </p>
      ) : null}
      {save.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      ) : null}

      <div className={styles.workspace}>
        <PlayerPanel
          project={project}
          edit={edit}
          onChange={setEdit}
          onTime={setCurrentMs}
          seekTo={seekTo}
        />
        <TranscriptAside
          project={project}
          segments={segments}
          edit={edit}
          saving={save.isPending}
          currentMs={currentMs}
          onChange={setEdit}
          onSeek={(ms) => setSeekTo({ ms })}
        />
      </div>

      <EditorTimeline
        project={project}
        segments={segments}
        currentMs={currentMs}
        onSeek={(ms) => setSeekTo({ ms })}
      />

      <ExportVideoPanel project={project} dirty={dirty} />
    </main>
  );
}
