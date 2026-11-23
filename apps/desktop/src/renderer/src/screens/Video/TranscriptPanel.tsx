import {
  TRANSCRIPT_LANGUAGES,
  TRANSCRIPT_LANGUAGE_LABELS,
  formatDurationMs,
  transcriptSegments,
  type TranscriptLanguage,
  type VideoProject,
} from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useToolsStatus, useTranscription } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import {
  LOW_CONFIDENCE,
  TOOL_NEEDS,
  missingTools,
  progressLabel,
  transcriptSummary,
} from '../../services/video';
import styles from './Video.module.css';

/** Quante frasi mostrare nell'anteprima: la trascrizione completa sta nell'editor (passo 3c). */
const PREVIEW_SEGMENTS = 12;

/** Trascrizione con whisper.cpp: lingua, avanzamento, riepilogo e prime frasi. */
export function TranscriptPanel({ project }: { project: VideoProject }) {
  const tools = useToolsStatus();
  const { start, progress, cancel } = useTranscription(project.id);
  const [language, setLanguage] = useState<TranscriptLanguage>(
    (project.transcript?.language as TranscriptLanguage | undefined) === 'en' ? 'en' : 'it',
  );
  const missing = tools.data ? missingTools(tools.data, TOOL_NEEDS.transcribe) : [];
  const transcript = project.transcript;
  const summary = transcript ? transcriptSummary(transcript, project.source.durationMs) : null;
  const segments = transcript
    ? transcriptSegments(transcript.words, project.source.durationMs).slice(0, PREVIEW_SEGMENTS)
    : [];

  return (
    <section aria-labelledby="h-trascrizione" className={styles.transcript}>
      <div className={styles.transcriptHead}>
        <h3 id="h-trascrizione" className={styles.transcriptTitle}>
          Trascrizione
        </h3>
        {transcript && (
          <span className={`${styles.itemMeta} mono`}>
            {transcript.model} · lingua {transcript.language}
          </span>
        )}
      </div>

      {start.isPending ? (
        <div className={styles.progress}>
          <span className={styles.progressLabel}>{progressLabel(progress)}</span>
          <progress
            className={styles.progressBar}
            max={100}
            value={progress?.percent ?? undefined}
            aria-label="Avanzamento della trascrizione"
          />
          <Button variant="secondary" size={32} onClick={cancel}>
            Annulla
          </Button>
        </div>
      ) : (
        <div className={styles.transcribeRow}>
          <label className={styles.languageField}>
            <span className={styles.itemMeta}>Lingua</span>
            <select
              className={styles.select}
              value={language}
              onChange={(event) => setLanguage(event.target.value as TranscriptLanguage)}
            >
              {TRANSCRIPT_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {TRANSCRIPT_LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <Button
            size={32}
            disabled={missing.length > 0}
            title={missing.length ? `Serve ${missing.join(', ')}` : undefined}
            onClick={() => start.mutate(language)}
          >
            {transcript ? 'Trascrivi di nuovo' : 'Trascrivi'}
          </Button>
        </div>
      )}

      {missing.length > 0 && (
        <p className={styles.note}>
          Per trascrivere servono {missing.join(', ')} (Impostazioni › Strumenti video).
        </p>
      )}
      {start.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(start.error)}
        </p>
      ) : null}

      {summary && (
        <p className={styles.summary}>
          {summary.words} parole · {summary.sentences} frasi · {summary.silences} silenzi (
          {summary.silenceLabel})
          {summary.uncertain > 0 ? ` · ${summary.uncertain} parole incerte` : ''}
        </p>
      )}
      {segments.length > 0 && (
        <ol className={styles.segments}>
          {segments.map((segment) => (
            <li key={`${segment.kind}-${segment.startMs}`} className={styles.segment}>
              <span className={`${styles.segmentTime} mono`}>
                {formatDurationMs(segment.startMs)}
              </span>
              {segment.kind === 'silence' ? (
                <span className={styles.silence}>
                  silenzio ·{' '}
                  {((segment.endMs - segment.startMs) / 1000).toLocaleString('it-IT', {
                    maximumFractionDigits: 1,
                  })}{' '}
                  s
                </span>
              ) : (
                <span>
                  {transcript!.words
                    .slice(segment.firstWord, segment.lastWord + 1)
                    .map((word, i) => (
                      <span
                        key={i}
                        className={word.p < LOW_CONFIDENCE ? styles.uncertain : undefined}
                        title={
                          word.p < LOW_CONFIDENCE ? 'Parola incerta: ricontrollala' : undefined
                        }
                      >
                        {i > 0 ? ' ' : ''}
                        {word.text}
                      </span>
                    ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
