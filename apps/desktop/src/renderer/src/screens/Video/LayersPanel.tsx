import {
  OVERLAY_KIND_LABELS,
  OVERLAY_KINDS,
  OVERLAY_LIMITS,
  type Overlay,
  type VideoEdit,
  type VideoProject,
} from '@prisma-app/shared';
import { newOverlay } from '../../services/enrich';
import { rangeLabel, removeById, replaceById } from '../../services/layers';
import styles from './VideoEditor.module.css';

interface LayersPanelProps {
  project: VideoProject;
  edit: VideoEdit;
  onChange: (edit: VideoEdit) => void;
  sourceMs: number;
  onSeek: (ms: number) => void;
}

/**
 * Pannello «Testi e B-roll» (6d): schede di testo modificabili (titolo, punti, codice) e
 * B-roll con la fonte; si aggiunge una scheda all'istante del player o si toglie.
 */
export function LayersPanel({ project, edit, onChange, sourceMs, onSeek }: LayersPanelProps) {
  const setOverlay = (next: Overlay) =>
    onChange({ ...edit, overlays: replaceById(edit.overlays, next) });
  const pixabay = edit.broll.some((b) => b.media.source === 'pixabay');

  return (
    <div className={styles.aiPanel}>
      <span className={styles.aiPanelTitle}>Testi e B-roll</span>
      {edit.overlays.length === 0 && edit.broll.length === 0 && (
        <span className={styles.audioNote}>
          Nessuna scheda né B-roll: usa «Aggiungi B-roll e testi» o aggiungi una scheda qui.
        </span>
      )}
      {edit.overlays.map((overlay) => (
        <div key={overlay.id} className={styles.layerItem}>
          <div className={styles.aiRow}>
            <button
              type="button"
              className={`${styles.layerTime} mono`}
              onClick={() => onSeek(overlay.startMs)}
            >
              {OVERLAY_KIND_LABELS[overlay.kind]} · {rangeLabel(overlay)}
            </button>
            <input
              aria-label="Titolo della scheda"
              value={overlay.title}
              maxLength={OVERLAY_LIMITS.titleMax}
              onChange={(e) => setOverlay({ ...overlay, title: e.target.value })}
            />
            <button
              type="button"
              className={styles.aiClear}
              onClick={() => onChange({ ...edit, overlays: removeById(edit.overlays, overlay.id) })}
            >
              Togli
            </button>
          </div>
          {overlay.kind !== 'title' && (
            <textarea
              aria-label={overlay.kind === 'code' ? 'Codice' : 'Punti, uno per riga'}
              className={`${styles.layerText} ${overlay.kind === 'code' ? 'mono' : ''}`}
              rows={overlay.kind === 'code' ? 4 : 3}
              value={overlay.kind === 'code' ? overlay.code : overlay.body}
              maxLength={overlay.kind === 'code' ? OVERLAY_LIMITS.codeMax : OVERLAY_LIMITS.bodyMax}
              onChange={(e) =>
                setOverlay(
                  overlay.kind === 'code'
                    ? { ...overlay, code: e.target.value }
                    : { ...overlay, body: e.target.value },
                )
              }
            />
          )}
        </div>
      ))}
      {edit.broll.map((item) => (
        <div key={item.id} className={styles.aiRow}>
          <button
            type="button"
            className={`${styles.layerTime} mono`}
            onClick={() => onSeek(item.startMs)}
          >
            B-roll · {rangeLabel(item)}
          </button>
          <span className={styles.layerName} title={item.media.fileName}>
            {item.query || item.media.fileName}
            <span className={styles.audioSummary}>
              {' '}
              · {item.media.credit ?? 'dalla tua cartella'}
            </span>
          </span>
          <button
            type="button"
            className={styles.aiClear}
            onClick={() => onChange({ ...edit, broll: removeById(edit.broll, item.id) })}
          >
            Togli
          </button>
        </div>
      ))}
      <div className={styles.aiRow}>
        Aggiungi qui una scheda:
        {OVERLAY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={styles.aiClear}
            disabled={edit.overlays.length >= OVERLAY_LIMITS.max}
            onClick={() =>
              onChange({
                ...edit,
                overlays: [...edit.overlays, newOverlay(kind, sourceMs, project.source.durationMs)],
              })
            }
          >
            + {OVERLAY_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      {pixabay && (
        <span className={styles.audioNote}>
          B-roll da{' '}
          <a href="https://pixabay.com/" target="_blank" rel="noreferrer">
            Pixabay
          </a>
          , con la licenza di Pixabay (uso gratuito, anche commerciale).
        </span>
      )}
    </div>
  );
}
