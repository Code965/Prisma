import {
  PLATFORM_LABELS,
  type Content,
  type Platform,
  type Tag,
  type Variant,
} from '@prisma-app/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Page } from '../../components/Page/Page';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { useBrand } from '../../hooks/brand';
import { useApproveVariant, useSaveVariant, type DraftValues } from '../../hooks/useStudio';
import { errorMessage } from '../../services/api/client';
import { isCarouselPlatform } from '../../services/carousel';
import { approvalSteps, isDirty, isReadOnly } from '../../services/studio';
import { ChatPanel } from './ChatPanel';
import { FeedPreview } from './FeedPreview';
import { PlatformFields } from './PlatformFields';
import styles from './Studio.module.css';

interface StudioBodyProps {
  content: Content;
  variants: Variant[];
  variant: Variant;
  tags: Tag[];
  onSelectPlatform: (platform: Platform) => void;
}

/** Corpo dello Studio per la variant della tab attiva: bozza locale, anteprima, campi, chat. */
export function StudioBody({
  content,
  variants,
  variant,
  tags,
  onSelectPlatform,
}: StudioBodyProps) {
  const { brand } = useBrand();
  const saved: DraftValues = { body: variant.body, metadata: variant.metadata };
  const [draft, setDraft] = useState<DraftValues>(saved);
  const dirty = isDirty(draft, saved);
  const readOnly = isReadOnly(variant.status);
  const save = useSaveVariant(content.id);
  const approve = useApproveVariant(content.id);
  const steps = approvalSteps(variant.status, dirty);
  const label = PLATFORM_LABELS[variant.platform];
  const anyApproved = variants.some((v) => v.status === 'approvato');
  const busy = save.isPending || approve.isPending;

  function selectTab(platform: Platform) {
    if (platform === variant.platform) return;
    if (dirty && !window.confirm('Hai modifiche non salvate su questa bozza. Vuoi lasciarle?'))
      return;
    onSelectPlatform(platform);
  }

  return (
    <div className={styles.layout}>
      <Page
        className={styles.main}
        breadcrumb={
          <>
            <Link to="/idee">Idee</Link> / Studio contenuto
          </>
        }
        title={content.title}
        titleExtra={tags.map((tag) => (
          <span key={tag.id} className={styles.tag}>
            {tag.name}
          </span>
        ))}
        actions={
          anyApproved ? (
            <Link to="/calendario" className={styles.primaryLink}>
              Pianifica nel calendario
            </Link>
          ) : null
        }
      >
        <div role="tablist" aria-label="Piattaforme" className={styles.tabs}>
          {variants.map((v) => {
            const selected = v.id === variant.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`${styles.tab} ${selected ? styles.tabOn : ''}`}
                onClick={() => selectTab(v.platform)}
              >
                <PlatformIcon platform={v.platform} size={22} />
                {PLATFORM_LABELS[v.platform]}
                <StatusPill status={v.status} />
              </button>
            );
          })}
        </div>

        <div role="tabpanel" aria-label={label} className={styles.panel}>
          <FeedPreview
            platform={variant.platform}
            body={draft.body}
            metadata={draft.metadata}
            status={variant.status}
            brandName={brand?.name ?? ''}
            initials={brand?.initials ?? ''}
          />

          <section aria-label="Campi della piattaforma" className={styles.fields}>
            <PlatformFields
              platform={variant.platform}
              draft={draft}
              readOnly={readOnly}
              onChange={setDraft}
            />

            {isCarouselPlatform(variant.platform) && (
              <div className={styles.carouselRow}>
                <span>
                  {variant.metadata.carousel
                    ? `Carosello · ${variant.metadata.carousel.slides.length} slide`
                    : 'Nessun carosello: le slide si creano nell’editor'}
                </span>
                {dirty ? (
                  <span className={styles.note}>Salva la bozza per aprire l’editor</span>
                ) : (
                  <Link
                    to={`/carosello/${content.id}/${variant.id}`}
                    className={styles.carouselLink}
                  >
                    {variant.metadata.carousel ? 'Modifica le slide' : 'Crea il carosello'}
                  </Link>
                )}
              </div>
            )}

            <div className={styles.footer}>
              {readOnly ? (
                <p className={styles.note}>
                  Bozza in coda o già pubblicata: per modificarla annulla prima la programmazione.
                </p>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    disabled={!dirty || busy}
                    onClick={() => save.mutate({ variant, draft })}
                  >
                    {save.isPending ? 'Salvo…' : 'Salva bozza'}
                  </Button>
                  {steps.length > 0 ? (
                    <Button
                      disabled={busy || !draft.body.trim()}
                      onClick={() => approve.mutate({ variant, draft, dirty })}
                    >
                      {approve.isPending ? 'Approvo…' : `Approva ${label}`}
                    </Button>
                  ) : variant.status === 'approvato' ? (
                    <span className={styles.approved}>Approvata: pronta da pianificare</span>
                  ) : null}
                </>
              )}
            </div>
            {save.error || approve.error ? (
              <p role="alert" className={styles.error}>
                {errorMessage(save.error ?? approve.error)}
              </p>
            ) : null}
          </section>
        </div>
      </Page>

      <ChatPanel
        contentId={content.id}
        variant={variant}
        draft={draft}
        dirty={dirty}
        readOnly={readOnly}
      />
    </div>
  );
}
