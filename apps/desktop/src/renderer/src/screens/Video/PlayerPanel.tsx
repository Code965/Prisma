import {
  SUBTITLE_STYLES,
  SUBTITLE_STYLE_LABELS,
  VIDEO_FORMATS,
  VIDEO_FORMAT_INFO,
  VIDEO_LAYOUT_LABELS,
  type VideoLayout,
  buildCaptions,
  captionAt,
  isKeyword,
  zoomAt,
  editedDurationMs,
  editedTimeMs,
  skipCuts,
  type SubtitleStyle,
  type VideoEdit,
  type VideoProject,
} from '@prisma-app/shared';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { zoomedOverlay } from '../../services/auto-edit';
import { mediaUrl } from '../../services/video';
import { clockLabel, cropOverlay, draggedOffset, sourceTimeMs } from '../../services/video-editor';
import { AudioPanel } from './AudioPanel';
import { FollowFaceControl } from './FollowFaceControl';
import { LayoutPreview } from './LayoutPreview';
import { currentLayout, layoutChoices } from '../../services/layout';
import { previewCropOffset, previewFollowPath } from '../../services/face';
import { LayersPanel } from './LayersPanel';
import { LayersPreview } from './LayersPreview';
import styles from './VideoEditor.module.css';

interface PlayerPanelProps {
  project: VideoProject;
  edit: VideoEdit;
  onChange: (edit: VideoEdit) => void;
  onTime: (sourceMs: number) => void;
  /** Richiesta di spostarsi a un istante del sorgente (da trascrizione o timeline). */
  seekTo: { ms: number } | null;
}

/** Nomi brevi dei layout per i pulsanti (il nome intero sta nel suggerimento). */
const LAYOUT_SHORT: Record<VideoLayout, string> = {
  camera: 'Tu',
  screen: 'Schermo',
  pip: 'Angolo',
  split: 'Diviso',
};

/** Campioni degli stili (mockup): testo e colori fissi, rappresentano il video esportato. */
const STYLE_SAMPLES: Record<SubtitleStyle, { className: string; text: string }> = {
  clean: { className: 'sampleClean', text: 'Una riga' },
  word: { className: 'sampleWord', text: 'Una riga' },
  box: { className: 'sampleDark', text: 'Una riga' },
  big: { className: 'sampleBig', text: 'Una riga' },
};

/**
 * Player: il video sorgente con il riquadro del formato (trascinabile), i sottotitoli nello
 * stile scelto e la riproduzione che salta le parti tagliate.
 */
export function PlayerPanel({ project, edit, onChange, onTime, seekTo }: PlayerPanelProps) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [sourceMs, setSourceMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const { source } = project;
  // Con «Segui il volto» la posizione del riquadro segue il percorso calcolato dai volti (6e).
  const followPathPoints = useMemo(() => previewFollowPath(project, edit), [project, edit]);
  const offset = dragOffset ?? previewCropOffset(followPathPoints, edit, sourceMs);
  const baseOverlay = cropOverlay(edit.format, source.width, source.height, offset);
  // Con uno zoom attivo il riquadro si restringe: è quello che finirà nel video (fase 6a).
  const zoom = zoomAt(edit.zooms, sourceMs);
  const overlay = zoomedOverlay(baseOverlay, zoom);
  const total = editedDurationMs(edit.cuts, source.durationMs);
  const captions = useMemo(
    () => (project.transcript ? buildCaptions(project.transcript.words, edit.cuts) : []),
    [project.transcript, edit.cuts],
  );
  const caption = captionAt(captions, sourceMs);

  // Mentre il video scorre si controlla a ogni fotogramma: le parti tagliate si saltano.
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    const tick = () => {
      const element = video.current;
      if (element) {
        const ms = element.currentTime * 1000;
        const next = skipCuts(edit.cuts, ms);
        if (next !== ms) {
          if (next >= source.durationMs) element.pause();
          else element.currentTime = next / 1000;
        }
        setSourceMs(element.currentTime * 1000);
        onTime(element.currentTime * 1000);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, edit.cuts, source.durationMs, onTime]);

  useEffect(() => {
    if (!seekTo || !video.current) return;
    video.current.currentTime = skipCuts(edit.cuts, seekTo.ms) / 1000;
    setSourceMs(video.current.currentTime * 1000);
    onTime(video.current.currentTime * 1000);
    // Solo quando arriva una nuova richiesta di spostamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo]);

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      element.currentTime = skipCuts(edit.cuts, element.currentTime * 1000) / 1000;
      void element.play();
    } else {
      element.pause();
    }
  }

  function seekEdited(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const ms = sourceTimeMs(edit.cuts, ratio * total, source.durationMs);
    if (video.current) video.current.currentTime = ms / 1000;
    setSourceMs(ms);
    onTime(ms);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (edit.format === '16:9' && overlay.width === 100 && overlay.height === 100) return;
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, offset: edit.cropOffset };
    const target = event.currentTarget;
    let latest = start.offset;
    const move = (e: globalThis.PointerEvent) => {
      latest = draggedOffset({
        startOffset: start.offset,
        deltaX: e.clientX - start.x,
        deltaY: e.clientY - start.y,
        frameWidth: box.width,
        frameHeight: box.height,
        overlay,
      });
      setDragOffset(latest);
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setDragOffset(null);
      // Spostare il riquadro a mano smette di seguire il volto.
      if (latest !== edit.cropOffset || edit.followFace) {
        onChange({ ...edit, cropOffset: latest, followFace: false });
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  const elapsed = editedTimeMs(edit.cuts, sourceMs);
  const movable = overlay.width < 100 || overlay.height < 100;

  return (
    <section aria-label="Player" className={styles.player}>
      <div className={styles.playerBar}>
        <div role="group" aria-label="Formato" className={styles.formats}>
          {VIDEO_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              aria-pressed={format === edit.format}
              className={`${styles.format} ${format === edit.format ? styles.formatOn : ''} mono`}
              onClick={() => onChange({ ...edit, format })}
            >
              {format}
            </button>
          ))}
        </div>
        <FollowFaceControl project={project} edit={edit} onChange={onChange} />
        {project.screen && (
          <div role="group" aria-label="Layout" className={styles.formats}>
            {layoutChoices(project, edit).map((layout) => (
              <button
                key={layout}
                type="button"
                aria-pressed={layout === currentLayout(project, edit)}
                className={`${styles.format} ${layout === currentLayout(project, edit) ? styles.formatOn : ''}`}
                title={VIDEO_LAYOUT_LABELS[layout]}
                onClick={() => onChange({ ...edit, layout })}
              >
                {LAYOUT_SHORT[layout]}
              </button>
            ))}
          </div>
        )}
        <span className={styles.formatNote}>{VIDEO_FORMAT_INFO[edit.format].note}</span>
      </div>

      <div className={styles.stage}>
        <div
          ref={frame}
          className={styles.frame}
          style={{ aspectRatio: `${source.width} / ${source.height}` }}
        >
          <video
            ref={video}
            className={styles.video}
            src={mediaUrl(project.id)}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onClick={togglePlay}
          />
          <div
            className={`${styles.crop} ${movable ? styles.cropMovable : ''}`}
            style={{
              left: `${overlay.left}%`,
              top: `${overlay.top}%`,
              width: `${overlay.width}%`,
              height: `${overlay.height}%`,
            }}
            onPointerDown={startDrag}
            aria-label={`Riquadro ${VIDEO_FORMAT_INFO[edit.format].label}`}
          >
            <span className={`${styles.cropLabel} mono`}>
              {VIDEO_FORMAT_INFO[edit.format].label}
            </span>
            {edit.hook && elapsed < edit.hook.durationMs && (
              <div className={styles.hook}>
                <span>{edit.hook.text}</span>
              </div>
            )}
            {zoom > 1 && (
              <span className={`${styles.zoomBadge} mono`}>
                Zoom ×{zoom.toFixed(2).replace('.', ',')}
              </span>
            )}
            {currentLayout(project, edit) !== 'camera' && (
              <LayoutPreview
                project={project}
                edit={edit}
                camera={video}
                offset={offset}
                zoom={zoom}
                sourceMs={sourceMs}
                playing={playing}
              />
            )}
            <LayersPreview edit={edit} sourceMs={sourceMs} playing={playing} />
            {caption && (
              <Subtitle styleId={edit.subtitles} caption={caption} keywords={edit.keywords} />
            )}
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          aria-label={playing ? 'Pausa' : 'Riproduci'}
          className={styles.play}
          onClick={togglePlay}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 4v16l13-8z" />
            </svg>
          )}
        </button>
        <span className={`${styles.time} mono`}>
          {clockLabel(elapsed)} / {clockLabel(total)}
        </span>
        <div
          className={styles.track}
          role="slider"
          aria-label="Posizione nel video montato"
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(elapsed / 1000)}
          tabIndex={0}
          onPointerDown={seekEdited}
        >
          <div
            className={styles.trackFill}
            style={{ width: `${total ? (elapsed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className={styles.subStyles}>
        <span className={styles.subStylesLabel}>Stile sottotitoli</span>
        <div role="group" aria-label="Stile sottotitoli" className={styles.subStyleGrid}>
          {SUBTITLE_STYLES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === edit.subtitles}
              className={`${styles.subStyle} ${id === edit.subtitles ? styles.subStyleOn : ''}`}
              onClick={() => onChange({ ...edit, subtitles: id })}
            >
              <span className={styles.sampleBox}>
                <span className={styles[STYLE_SAMPLES[id].className]}>
                  {STYLE_SAMPLES[id].text}
                </span>
              </span>
              <span className={styles.subStyleName}>{SUBTITLE_STYLE_LABELS[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <LayersPanel
        project={project}
        edit={edit}
        onChange={onChange}
        sourceMs={sourceMs}
        onSeek={(ms) => {
          if (video.current) video.current.currentTime = ms / 1000;
          setSourceMs(ms);
          onTime(ms);
        }}
      />

      <AudioPanel
        project={project}
        edit={edit}
        onChange={onChange}
        playing={playing}
        sourceMs={sourceMs}
        totalMs={total}
      />

      {(edit.hook || edit.keywords.length > 0 || edit.zooms.length > 0) && (
        <div className={styles.aiPanel}>
          <span className={styles.aiPanelTitle}>Montaggio dell’AI</span>
          {edit.hook && (
            <label className={styles.aiRow}>
              Titolo d’apertura
              <input
                value={edit.hook.text}
                maxLength={80}
                onChange={(event) =>
                  onChange({
                    ...edit,
                    hook: event.target.value.trim()
                      ? { ...edit.hook!, text: event.target.value }
                      : edit.hook,
                  })
                }
              />
              <button
                type="button"
                className={styles.aiClear}
                onClick={() => onChange({ ...edit, hook: null })}
              >
                Togli
              </button>
            </label>
          )}
          {edit.keywords.length > 0 && (
            <div className={styles.aiRow}>
              {edit.keywords.length} parole chiave evidenziate nei sottotitoli
              <button
                type="button"
                className={styles.aiClear}
                onClick={() => onChange({ ...edit, keywords: [] })}
              >
                Togli
              </button>
            </div>
          )}
          {edit.zooms.length > 0 && (
            <div className={styles.aiRow}>
              {edit.zooms.length} zoom (ai tagli e sulle frasi importanti)
              <button
                type="button"
                className={styles.aiClear}
                onClick={() => onChange({ ...edit, zooms: [] })}
              >
                Togli
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Subtitle({
  styleId,
  caption,
  keywords,
}: {
  styleId: SubtitleStyle;
  caption: NonNullable<ReturnType<typeof captionAt>>;
  keywords: readonly number[];
}) {
  const { words } = caption.caption;
  const keyword = (i: number) => (isKeyword(keywords, words[i]!) ? styles.subKeyword : undefined);
  if (styleId === 'big') {
    const active = words[caption.activeWord];
    return (
      <span className={`${styles.subBig} ${keyword(caption.activeWord) ?? ''}`}>
        {active?.text}
      </span>
    );
  }
  const wordClass = (i: number) =>
    styleId === 'word' && i === caption.activeWord ? styles.subWordActive : keyword(i);
  return (
    <span
      className={
        styleId === 'word' ? styles.subWord : styleId === 'box' ? styles.subBox : styles.subClean
      }
    >
      {words.map((word, i) => (
        <span key={i} className={wordClass(i)}>
          {i > 0 ? ' ' : ''}
          {word.text}
        </span>
      ))}
    </span>
  );
}
