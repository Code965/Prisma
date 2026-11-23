import { PLATFORM_LABELS } from '@prisma-app/shared';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { useContents } from '../../hooks/useCalendar';
import { useContent } from '../../hooks/useStudio';
import { errorMessage } from '../../services/api/client';
import { carouselCandidates, isCarouselPlatform } from '../../services/carousel';
import styles from './Carosello.module.css';
import { CarouselEditor } from './CarouselEditor';

const SUBTITLE = 'Slide da template HTML, anteprima 1080×1350, export JPEG e PDF.';

function positiveId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Editor carosello (V3Carosello): senza variant indicata mostra i contenuti da cui partire. */
export function CaroselloScreen() {
  const params = useParams();
  const contentId = positiveId(params.contentId);
  const variantId = positiveId(params.variantId);
  if (!contentId || !variantId) return <CarouselPicker />;
  return <EditorLoader contentId={contentId} variantId={variantId} />;
}

function EditorLoader({ contentId, variantId }: { contentId: number; variantId: number }) {
  const content = useContent(contentId);
  const variant = content.data?.variants.find((v) => v.id === variantId);

  if (!content.data || !variant || !isCarouselPlatform(variant.platform)) {
    const message = content.error
      ? errorMessage(content.error)
      : !content.data
        ? 'Carico il contenuto…'
        : 'Questa bozza non può diventare un carosello: servono LinkedIn, Instagram o TikTok.';
    return (
      <Page title="Editor carosello" subtitle={SUBTITLE}>
        <Panel label="Stato">
          <p className={styles.note}>{message}</p>
        </Panel>
      </Page>
    );
  }
  return <CarouselEditor content={content.data} variant={variant} />;
}

function CarouselPicker() {
  const contents = useContents();
  const candidates = carouselCandidates(contents.data ?? []);
  return (
    <Page title="Editor carosello" subtitle={SUBTITLE}>
      <Panel label="Scegli una bozza">
        <div className={styles.picker}>
          <p className={styles.note}>
            Scegli la bozza da trasformare in carosello, oppure aprila dallo Studio.
          </p>
          {contents.error ? (
            <p role="alert" className={styles.error}>
              {errorMessage(contents.error)}
            </p>
          ) : null}
          {candidates.map(({ content, variants }) => (
            <div key={content.id} className={styles.pickRow}>
              <span className={styles.pickTitle}>{content.title}</span>
              <span className={styles.pickVariants}>
                {variants.map((v) => (
                  <Link
                    key={v.id}
                    to={`/carosello/${content.id}/${v.id}`}
                    className={styles.pickLink}
                  >
                    <PlatformIcon platform={v.platform} size={20} />
                    {PLATFORM_LABELS[v.platform]}
                    {v.metadata.carousel && (
                      <span className={`${styles.pickCount} mono`}>
                        {v.metadata.carousel.slides.length} slide
                      </span>
                    )}
                    <StatusPill status={v.status} />
                  </Link>
                ))}
              </span>
            </div>
          ))}
          {contents.data && candidates.length === 0 && (
            <p className={styles.note}>
              Nessun contenuto con bozze per LinkedIn, Instagram o TikTok: generane uno da Idee.
            </p>
          )}
        </div>
      </Panel>
    </Page>
  );
}
