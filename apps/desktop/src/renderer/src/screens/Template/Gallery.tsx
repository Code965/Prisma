import { CAROUSEL_TEMPLATES, CAROUSEL_TEMPLATE_LABELS, type BrandKit } from '@prisma-app/shared';
import { renderSlideHtml } from '@prisma-app/templates';
import { useMemo } from 'react';
import { SlideFrame } from '../../components/SlideFrame/SlideFrame';
import { slideFontFaceCss } from '../../components/SlideFrame/slide-fonts';
import { useBrand } from '../../hooks/brand';
import { draftKit, galleryCarousel, type KitDraft } from '../../services/brand-kit';
import styles from './Template.module.css';

const THUMB_WIDTH = 112;

/**
 * Galleria degli stili (7a): ogni stile disegnato con il vero renderer delle slide e il kit in
 * bozza (colori, font, logo, handle), quindi coincide con quello che esce dall'export.
 */
export function Gallery({ kit, draft }: { kit: BrandKit; draft: KitDraft }) {
  const { brand } = useBrand();
  const fontFaceCss = useMemo(() => slideFontFaceCss(), []);
  const shown = useMemo(() => draftKit(kit, draft), [kit, draft]);
  const initials = brand?.initials ?? '';

  return (
    <section aria-labelledby="h-gal" className={styles.gallerySection}>
      <h2 id="h-gal" className={styles.h2}>
        Galleria
      </h2>
      <div className={styles.gallery}>
        {CAROUSEL_TEMPLATES.map((template) => {
          const carousel = galleryCarousel(template);
          return (
            <article key={template} className={styles.card}>
              <div className={styles.well}>
                {carousel.slides.map((slide, index) => (
                  <SlideFrame
                    key={slide.kind}
                    width={THUMB_WIDTH}
                    title={`${CAROUSEL_TEMPLATE_LABELS[template]}, slide ${index + 1}`}
                    html={renderSlideHtml({ carousel, index, kit: shown, initials, fontFaceCss })}
                  />
                ))}
              </div>
              <div className={styles.cardText}>
                <span className={styles.cardName}>
                  {CAROUSEL_TEMPLATE_LABELS[template]}
                  {draft.videoTemplate === template ? (
                    <span className={styles.badge}>Video</span>
                  ) : null}
                </span>
                <span className={`${styles.cardSize} mono`}>Caroselli e post · 1080×1350</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
