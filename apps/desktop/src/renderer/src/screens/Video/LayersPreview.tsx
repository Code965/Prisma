import {
  DEFAULT_BRAND_KIT,
  VIDEO_FORMAT_INFO,
  brollAt,
  overlayAt,
  type Broll,
  type VideoEdit,
} from '@prisma-app/shared';
import { renderOverlayCardHtml } from '@prisma-app/templates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { slideFontFaceCss } from '../../components/SlideFrame/slide-fonts';
import { useBrandKit } from '../../hooks/useBrandKit';
import { DEFAULT_VIDEO_TEMPLATE } from '../../services/create-video';
import { brollPreviewSeconds } from '../../services/layers';
import { brollUrl } from '../../services/video';
import styles from './VideoEditor.module.css';

interface LayersPreviewProps {
  edit: VideoEdit;
  sourceMs: number;
  playing: boolean;
}

/**
 * Anteprima di B-roll e schede dentro il riquadro del formato (6d): lo spezzone o l'immagine
 * copre tutto, la scheda è lo stesso HTML del render in un iframe scalato.
 */
export function LayersPreview({ edit, sourceMs, playing }: LayersPreviewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const broll = brollAt(edit.broll, sourceMs);
  const card = overlayAt(edit.overlays, sourceMs);
  const kit = useBrandKit().data ?? DEFAULT_BRAND_KIT;
  const fontFaceCss = useMemo(() => slideFontFaceCss(), []);
  const info = VIDEO_FORMAT_INFO[edit.format];

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const html = useMemo(
    () =>
      card
        ? renderOverlayCardHtml({
            overlay: card,
            kit,
            template: DEFAULT_VIDEO_TEMPLATE,
            width: info.width,
            height: info.height,
            fontFaceCss,
          })
        : null,
    [card, kit, info.width, info.height, fontFaceCss],
  );
  const scale = width / info.width;

  return (
    <div ref={box} className={styles.layers} aria-hidden="true">
      {broll && <BrollPreview broll={broll} sourceMs={sourceMs} playing={playing} />}
      {html && width > 0 && (
        <iframe
          title="Scheda di testo"
          sandbox="allow-same-origin"
          srcDoc={html}
          tabIndex={-1}
          className={styles.cardFrame}
          style={{ width: info.width, height: info.height, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}

function BrollPreview({
  broll,
  sourceMs,
  playing,
}: {
  broll: Broll;
  sourceMs: number;
  playing: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const url = brollUrl(broll.media.key);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const target = brollPreviewSeconds(broll, sourceMs);
    if (Math.abs(element.currentTime - target) > 0.3) element.currentTime = target;
    if (playing && element.paused) void element.play().catch(() => {});
    if (!playing && !element.paused) element.pause();
  }, [broll, sourceMs, playing]);

  return broll.media.kind === 'video' ? (
    <video ref={video} className={styles.brollMedia} src={url} muted playsInline preload="auto" />
  ) : (
    <img className={`${styles.brollMedia} ${styles.brollImage}`} src={url} alt="" />
  );
}
