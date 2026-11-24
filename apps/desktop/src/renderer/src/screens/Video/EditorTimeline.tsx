import type { VideoProject } from '@prisma-app/shared';
import type { PointerEvent } from 'react';
import { musicTrackLabel } from '../../services/audio';
import { rulerLabels, type EditorSegment } from '../../services/video-editor';
import styles from './VideoEditor.module.css';

interface EditorTimelineProps {
  project: VideoProject;
  segments: EditorSegment[];
  currentMs: number;
  onSeek: (ms: number) => void;
}

/**
 * Timeline con 4 tracce (V3Video): video e sottotitoli seguono i segmenti della trascrizione
 * (i tratti tagliati sono tratteggiati). Testi e musica arriveranno con il render.
 */
export function EditorTimeline({ project, segments, currentMs, onSeek }: EditorTimelineProps) {
  const duration = project.source.durationMs;
  const items = segments.length > 0 ? segments : null;

  function seek(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  }

  return (
    <section aria-labelledby="h-tl" className={styles.timeline}>
      <div className={styles.timelineHead}>
        <h2 id="h-tl" className={styles.timelineTitle}>
          Timeline
        </h2>
        <span className={`${styles.asideMeta} mono`}>
          {rulerLabels(duration)[0]} – {rulerLabels(duration)[4]}
        </span>
      </div>
      <div role="region" aria-label="Tracce" tabIndex={0} className={styles.tracksScroll}>
        <div className={styles.tracks}>
          <div className={styles.rulerRow}>
            <span />
            <div className={`${styles.ruler} mono`}>
              {rulerLabels(duration).map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          </div>

          <div className={styles.trackRow}>
            <span className={styles.trackName}>Video</span>
            <div className={styles.videoTrack} onPointerDown={seek}>
              {items ? (
                items.map((segment) => (
                  <div
                    key={segment.key}
                    className={`${styles.clip} ${segment.cut ? styles.clipCut : ''}`}
                    style={{
                      flexGrow: Math.max(1, Math.round((segment.endMs - segment.startMs) / 100)),
                    }}
                  />
                ))
              ) : (
                <div className={styles.clip} style={{ flexGrow: 1 }} />
              )}
            </div>
          </div>

          <div className={styles.trackRow}>
            <span className={styles.trackName}>Sottotitoli</span>
            <div className={styles.subTrack} onPointerDown={seek}>
              {items?.map((segment) => (
                <div
                  key={segment.key}
                  className={`${styles.subClip} ${segment.kind === 'speech' && !segment.cut ? styles.subClipOn : ''}`}
                  style={{
                    flexGrow: Math.max(1, Math.round((segment.endMs - segment.startMs) / 100)),
                  }}
                >
                  {segment.kind === 'speech' && !segment.cut ? segment.text : ''}
                </div>
              ))}
            </div>
          </div>

          <div className={styles.trackRow}>
            <span className={styles.trackName}>Testi e overlay</span>
            <div className={styles.emptyTrack}>
              Titoli e riquadri di codice: arrivano con il render
            </div>
          </div>

          <div className={styles.trackRow}>
            <span className={styles.trackName}>Musica</span>
            {project.edit.audio.music ? (
              <div className={styles.musicClip} title={project.edit.audio.music.fileName}>
                {musicTrackLabel(project.edit.audio.music)}
              </div>
            ) : (
              <div className={styles.emptyTrack}>Nessuna musica: sceglila nel pannello Audio</div>
            )}
          </div>

          <div
            aria-hidden
            className={styles.playhead}
            style={{
              left: `calc(120px + (100% - 120px) * ${duration ? currentMs / duration : 0})`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
