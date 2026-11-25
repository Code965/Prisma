import { templateChoices, type BrandKit, type TemplateId } from '@prisma-app/shared';
import { renderSlideHtml } from '@prisma-app/templates';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SlideFrame } from '../../components/SlideFrame/SlideFrame';
import { slideFontFaceCss } from '../../components/SlideFrame/slide-fonts';
import { useBrand } from '../../hooks/brand';
import { useSaveBrandKit } from '../../hooks/useBrandKit';
import { errorMessage } from '../../services/api/client';
import { draftKit, galleryCarousel, type KitDraft } from '../../services/brand-kit';
import {
  MAX_CUSTOM_TEMPLATES,
  canAddTemplate,
  duplicateDraft,
  editDraft,
  type TemplateDraft,
} from '../../services/template-editor';
import { TemplateEditor } from './TemplateEditor';
import styles from './Template.module.css';

const THUMB_WIDTH = 112;

/**
 * Galleria dei template (7a-7c): ogni stile disegnato con il vero renderer e il kit in bozza,
 * con le azioni «Duplica e modifica», «Modifica» (solo i tuoi) e i predefiniti di caroselli e
 * video, salvati subito.
 */
export function Gallery({ kit, draft }: { kit: BrandKit; draft: KitDraft }) {
  const { brand } = useBrand();
  const save = useSaveBrandKit();
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const fontFaceCss = useMemo(() => slideFontFaceCss(), []);
  const shown = useMemo(() => draftKit(kit, draft), [kit, draft]);
  const initials = brand?.initials ?? '';
  const canAdd = canAddTemplate(kit.templates);

  const setDefault = (key: 'carouselTemplate' | 'videoTemplate', id: TemplateId) =>
    save.mutate({ ...kit, [key]: id });

  return (
    <section aria-labelledby="h-gal" className={styles.gallerySection}>
      <div className={styles.galleryHead}>
        <h2 id="h-gal" className={styles.h2}>
          Galleria
        </h2>
        <Button
          size={32}
          variant="secondary"
          disabled={!canAdd}
          title={canAdd ? undefined : `Al massimo ${MAX_CUSTOM_TEMPLATES} template`}
          onClick={() => setEditing({ ...duplicateDraft('scuro', kit.templates), name: '' })}
        >
          + Nuovo template
        </Button>
      </div>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      ) : null}
      <div className={styles.gallery}>
        {templateChoices(kit.templates).map(({ id, label, custom }) => {
          const carousel = galleryCarousel(id);
          const forCarousels = kit.carouselTemplate === id;
          const forVideos = kit.videoTemplate === id;
          return (
            <article key={id} className={styles.card}>
              <div className={styles.well}>
                {carousel.slides.map((slide, index) => (
                  <SlideFrame
                    key={slide.kind}
                    width={THUMB_WIDTH}
                    title={`${label}, slide ${index + 1}`}
                    html={renderSlideHtml({ carousel, index, kit: shown, initials, fontFaceCss })}
                  />
                ))}
              </div>
              <div className={styles.cardText}>
                <span className={styles.cardName}>
                  {label}
                  {forCarousels ? <span className={styles.badge}>Caroselli</span> : null}
                  {forVideos ? <span className={styles.badge}>Video</span> : null}
                </span>
                <span className={`${styles.cardSize} mono`}>
                  {custom ? 'Tuo template' : 'Stile pronto'} · 1080×1350
                </span>
                <div className={styles.cardActions}>
                  {custom ? (
                    <button
                      type="button"
                      className={styles.cardAction}
                      onClick={() => {
                        const template = kit.templates.find((t) => t.id === id);
                        if (template) setEditing(editDraft(template));
                      }}
                    >
                      Modifica
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.cardAction}
                    disabled={!canAdd}
                    onClick={() => setEditing(duplicateDraft(id, kit.templates))}
                  >
                    Duplica e modifica
                  </button>
                  {forCarousels ? null : (
                    <button
                      type="button"
                      className={styles.cardAction}
                      disabled={save.isPending}
                      onClick={() => setDefault('carouselTemplate', id)}
                    >
                      Usa per i caroselli
                    </button>
                  )}
                  {forVideos ? null : (
                    <button
                      type="button"
                      className={styles.cardAction}
                      disabled={save.isPending}
                      onClick={() => setDefault('videoTemplate', id)}
                    >
                      Usa per i video
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className={styles.hint}>
        «Caroselli»: il template con cui nascono i caroselli nuovi (anche quelli dell’AI). «Video»:
        slide di «Crea video», schede di testo e fondo attorno allo schermo registrato.
      </p>
      {editing ? (
        <TemplateEditor
          kit={kit}
          shown={shown}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
