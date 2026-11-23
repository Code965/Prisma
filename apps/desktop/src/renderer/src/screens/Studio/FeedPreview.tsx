import {
  STATUS_DISPLAY,
  type Platform,
  type VariantMetadata,
  type VariantStatus,
} from '@prisma-app/shared';
import { Icon } from '../../components/icons/Icon';
import { useNow } from '../../hooks/useNow';
import { headline, previewText } from '../../services/studio';
import { BlogPreview } from './BlogPreview';
import styles from './FeedPreview.module.css';

interface FeedPreviewProps {
  platform: Platform;
  body: string;
  metadata: VariantMetadata;
  status: VariantStatus;
  brandName: string;
  initials: string;
}

/**
 * Anteprima realistica del post come apparirà nel feed (V3Studio). Si aggiorna mentre scrivi.
 * Le immagini sono riquadri grafici con il titolo finché non arrivano template e video (fasi 2-3).
 */
export function FeedPreview(props: FeedPreviewProps) {
  const now = useNow();
  const blog = props.platform === 'blog';
  return (
    <section
      aria-label={blog ? 'Anteprima dell’articolo' : 'Anteprima nel feed'}
      className={styles.preview}
    >
      <span className={`${styles.label} mono`}>
        {blog ? 'ANTEPRIMA SUL SITO' : 'ANTEPRIMA NEL FEED'}
      </span>
      {props.platform === 'linkedin' && <LinkedInPreview {...props} />}
      {props.platform === 'instagram' && <InstagramPreview {...props} />}
      {props.platform === 'tiktok' && <TikTokPreview {...props} />}
      {props.platform === 'youtube' && <YouTubePreview {...props} />}
      {blog && (
        <BlogPreview
          body={props.body}
          metadata={props.metadata}
          author={props.brandName}
          date={now}
        />
      )}
    </section>
  );
}

function hashtagLine(metadata: VariantMetadata): string {
  return metadata.hashtags.join(' ');
}

function More({ show }: { show: boolean }) {
  return show ? <span className={styles.muted}> … altro</span> : null;
}

function LinkedInPreview({ body, metadata, status, brandName, initials }: FeedPreviewProps) {
  const full = [body.trim(), hashtagLine(metadata)].filter(Boolean).join('\n\n');
  const text = previewText(full, 210);
  return (
    <article className={`${styles.card} ${styles.linkedin}`}>
      <div className={styles.liHead}>
        <div className={styles.liAvatar}>{initials}</div>
        <div className={styles.liWho}>
          <span className={styles.liName}>{brandName}</span>
          <span className={styles.muted}>{STATUS_DISPLAY[status].label}</span>
        </div>
      </div>
      <p className={styles.liText}>
        {text.text || <span className={styles.muted}>Il testo del post apparirà qui.</span>}
        <More show={text.truncated} />
      </p>
      <div className={styles.liActions}>
        <span>Consiglia</span>
        <span>Commenta</span>
        <span>Diffondi</span>
        <span>Invia</span>
      </div>
    </article>
  );
}

function InstagramPreview(props: FeedPreviewProps) {
  const { body, metadata, brandName, initials } = props;
  const caption = previewText([body.trim(), hashtagLine(metadata)].filter(Boolean).join(' '), 125);
  return (
    <article className={`${styles.card} ${styles.instagram}`}>
      <div className={styles.igHead}>
        <div className={styles.igAvatar}>{initials}</div>
        <span className={styles.igName}>{brandName}</span>
      </div>
      <div className={styles.igVisual}>
        <span className={`${styles.igCounter} mono`}>1/1</span>
        <span className={styles.igHeadline}>{headline({ body, metadata }) || '—'}</span>
        <span className={`${styles.igHint} mono`}>immagine dal template · fase 2</span>
      </div>
      <div className={styles.igIcons}>
        <Icon name="heart" size={22} />
        <Icon name="comment" size={22} />
        <Icon name="coda" size={22} />
        <span className={styles.igSpacer} />
        <Icon name="bookmark" size={22} />
      </div>
      <p className={styles.igCaption}>
        <strong>{brandName}</strong> {caption.text}
        <More show={caption.truncated} />
      </p>
    </article>
  );
}

function TikTokPreview({ body, metadata, brandName, initials }: FeedPreviewProps) {
  const caption = previewText([body.trim(), hashtagLine(metadata)].filter(Boolean).join(' '), 110);
  return (
    <article className={styles.tiktok}>
      <span className={styles.ttHeadline}>{headline({ body, metadata }, 60) || '—'}</span>
      <div className={styles.ttSide} aria-hidden>
        <span className={styles.ttAvatar}>{initials}</span>
        <Icon name="heart" size={26} />
        <Icon name="comment" size={26} />
        <Icon name="bookmark" size={26} />
      </div>
      <div className={styles.ttCaption}>
        <span className={styles.ttName}>{brandName}</span>
        <span className={styles.ttText}>
          {caption.text}
          {caption.truncated && '…'}
        </span>
        <span className={styles.ttAudio}>audio originale</span>
      </div>
    </article>
  );
}

function YouTubePreview({ body, metadata, status, brandName, initials }: FeedPreviewProps) {
  const title = metadata.title || headline({ body, metadata }, 100);
  return (
    <article className={styles.youtube}>
      <div className={styles.ytThumb}>
        <span className={`${styles.ytKicker} mono`}>// miniatura · fase 3</span>
        <span className={styles.ytThumbTitle}>{previewText(title, 48).text || '—'}</span>
      </div>
      <div className={styles.ytMeta}>
        <div className={styles.ytAvatar}>{initials}</div>
        <div className={styles.ytText}>
          <span className={styles.ytTitle}>{title || 'Titolo del video'}</span>
          <span className={styles.muted}>
            {brandName} · {STATUS_DISPLAY[status].label.toLowerCase()}
          </span>
        </div>
      </div>
    </article>
  );
}
