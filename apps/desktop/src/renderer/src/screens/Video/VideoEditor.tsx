import {
  applyAutoEdit,
  editedDurationMs,
  formatDurationMs,
  type VideoEdit,
  type VideoProject,
} from '@prisma-app/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAutoEdit, useEnrich, useGenerateShorts, useSaveVideoEdit } from '../../hooks/useVideo';
import { autoEditToast } from '../../services/auto-edit';
import { enrichToast, withEnrichment } from '../../services/enrich';
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
  const autoEdit = useAutoEdit(project);
  const enrich = useEnrich(project);
  // Modifiche di prima di «Aggiungi B-roll e testi», per «Annulla».
  const [beforeEnrich, setBeforeEnrich] = useState<VideoEdit | null>(null);
  // Modifiche di prima di «Monta con l'AI», per tornare indietro con «Annulla».
  const [beforeAutoEdit, setBeforeAutoEdit] = useState<VideoEdit | null>(null);
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

  function handleAutoEdit() {
    setToast(null);
    autoEdit.mutate(undefined, {
      onSuccess: (plan) => {
        if (!project.transcript) return;
        const result = applyAutoEdit(
          edit,
          project.transcript.words,
          project.source.durationMs,
          plan,
        );
        setBeforeAutoEdit(edit);
        setBeforeEnrich(null);
        setEdit(result.edit);
        setToast(autoEditToast(result.summary));
      },
    });
  }

  function handleEnrich() {
    setToast(null);
    enrich.mutate(edit.format, {
      onSuccess: (result) => {
        setBeforeEnrich(edit);
        setBeforeAutoEdit(null);
        setEdit(withEnrichment(edit, result.overlays, result.broll));
        setToast(enrichToast(result.summary));
      },
    });
  }

  function undoEnrich() {
    if (!beforeEnrich) return;
    setEdit(beforeEnrich);
    setBeforeEnrich(null);
    setToast('B-roll e testi annullati.');
  }

  function undoAutoEdit() {
    if (!beforeAutoEdit) return;
    setEdit(beforeAutoEdit);
    setBeforeAutoEdit(null);
    setToast('Montaggio dell’AI annullato.');
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
            className={`${styles.action} ${styles.actionPrimary}`}
            disabled={!autoEdit.available || autoEdit.isPending}
            title={
              autoEdit.available
                ? 'Taglia silenzi e riempitivi, propone titolo, parole chiave e zoom'
                : 'Prima trascrivi il video'
            }
            aria-busy={autoEdit.isPending}
            onClick={handleAutoEdit}
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
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
            </svg>
            {autoEdit.isPending ? 'Monto il video…' : 'Monta con l’AI'}
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={!enrich.available || enrich.isPending}
            title={
              enrich.available
                ? 'Schede di testo con il brand kit e B-roll dalla tua cartella o da Pixabay'
                : 'Prima trascrivi il video'
            }
            aria-busy={enrich.isPending}
            onClick={handleEnrich}
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
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 15l5-5 4 4 3-3 6 6" />
            </svg>
            {enrich.isPending ? 'Cerco B-roll e testi…' : 'Aggiungi B-roll e testi'}
          </button>
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
          {beforeEnrich && (
            <button type="button" className={styles.toastUndo} onClick={undoEnrich}>
              Annulla
            </button>
          )}
          {beforeAutoEdit && (
            <button type="button" className={styles.toastUndo} onClick={undoAutoEdit}>
              Annulla
            </button>
          )}
        </div>
      )}
      {enrich.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(enrich.error)}
        </p>
      ) : null}
      {autoEdit.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(autoEdit.error)}
        </p>
      ) : null}
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
