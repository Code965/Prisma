import {
  TRANSCRIPT_LANGUAGE_LABELS,
  cutDurationMs,
  formatDurationMs,
  toggleCut,
  type TranscriptLanguage,
  type VideoEdit,
  type VideoProject,
} from '@prisma-app/shared';
import type { EditorSegment } from '../../services/video-editor';
import { TranscriptPanel } from './TranscriptPanel';
import styles from './VideoEditor.module.css';

interface TranscriptAsideProps {
  project: VideoProject;
  segments: EditorSegment[];
  edit: VideoEdit;
  saving: boolean;
  currentMs: number;
  onChange: (edit: VideoEdit) => void;
  onSeek: (ms: number) => void;
}

function languageLabel(code: string): string {
  return TRANSCRIPT_LANGUAGE_LABELS[code as TranscriptLanguage]?.toLowerCase() ?? code;
}

/** Colonna «Trascrizione» (V3Video): clic su una frase per tagliarla, sull'orario per andarci. */
export function TranscriptAside(props: TranscriptAsideProps) {
  const { project, segments, edit } = props;
  if (!project.transcript) {
    return (
      <aside aria-labelledby="h-tr" className={styles.aside}>
        <h2 id="h-tr" className={styles.asideTitle}>
          Trascrizione
        </h2>
        <p className={styles.hint}>
          Per tagliare dal testo serve la trascrizione: falla qui, con Whisper sul computer.
        </p>
        <TranscriptPanel project={project} />
      </aside>
    );
  }

  const cutCount = segments.filter((s) => s.cut).length;
  const active = segments.find((s) => props.currentMs >= s.startMs && props.currentMs < s.endMs);

  return (
    <aside aria-labelledby="h-tr" className={styles.aside}>
      <div className={styles.asideHead}>
        <h2 id="h-tr" className={styles.asideTitle}>
          Trascrizione
        </h2>
        <span className={`${styles.asideMeta} mono`}>
          Whisper locale · {languageLabel(project.transcript.language)}
        </span>
      </div>
      <p className={styles.hint}>
        Clicca una frase per tagliarla dal video. Clicca di nuovo per ripristinarla.
      </p>
      <div className={styles.segments}>
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={`${styles.segmentRow} ${segment.cut ? styles.segmentCut : ''} ${segment === active ? styles.segmentActive : ''}`}
          >
            <button
              type="button"
              className={`${styles.segmentAt} mono`}
              title="Vai a questo punto"
              onClick={() => props.onSeek(segment.startMs)}
            >
              {segment.atLabel}
            </button>
            <button
              type="button"
              aria-pressed={segment.cut}
              className={styles.segmentText}
              onClick={() => props.onChange({ ...edit, cuts: toggleCut(edit.cuts, segment) })}
            >
              {segment.kind === 'silence' ? (
                <span className={`${styles.silencePill} mono`}>
                  silenzio {segment.durationLabel}
                </span>
              ) : (
                segment.text
              )}
            </button>
          </div>
        ))}
      </div>
      <div className={styles.asideFooter}>
        <span>
          {cutCount} tagli{props.saving ? ' · salvo…' : ''}
        </span>
        <span className="mono">
          −{formatDurationMs(cutDurationMs(edit.cuts, project.source.durationMs))}
        </span>
      </div>
    </aside>
  );
}
