import type { CSSProperties } from 'react';
import { useBrand } from '../../hooks/brand';
import { GALLERY_TEMPLATES, type GalleryTemplate, type KitDraft } from '../../services/brand-kit';
import styles from './Template.module.css';

/**
 * Galleria dei template (V3Template). Le miniature usano i colori del brand kit, così si vede
 * subito l'effetto di una modifica; i template veri arrivano con l'editor carosello.
 */
export function Gallery({ draft }: { draft: KitDraft }) {
  const { colors } = draft;
  const style = {
    '--k-ink': colors.ink,
    '--k-paper': colors.paper,
    '--k-accent': colors.accent,
    '--k-accentSoft': colors.accentSoft,
    '--k-code': colors.code,
  } as CSSProperties;

  return (
    <section aria-labelledby="h-gal" className={styles.gallerySection} style={style}>
      <h2 id="h-gal" className={styles.h2}>
        Galleria
      </h2>
      <div className={styles.gallery}>
        {GALLERY_TEMPLATES.map((template) => (
          <article key={template.id} className={styles.card}>
            <div className={styles.well}>
              <Thumb id={template.id} />
            </div>
            <div className={styles.cardText}>
              <span className={styles.cardName}>{template.name}</span>
              <span className={`${styles.cardSize} mono`}>{template.size}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Thumb({ id }: { id: GalleryTemplate['id'] }) {
  const { brand } = useBrand();
  const author = brand?.name.split(' ')[0] ?? '';
  switch (id) {
    case 'carosello':
      return (
        <>
          <div className={`${styles.thumb} ${styles.tCarousel}`}>
            <span className={`${styles.tKicker} mono`}>01</span>
            <span className={styles.tTitle}>Titolo della copertina</span>
          </div>
          <div aria-hidden className={styles.tStrip} />
        </>
      );
    case 'post':
      return (
        <div className={`${styles.thumb} ${styles.tPost}`}>
          <span className={styles.tTitle}>Un concetto, una immagine</span>
          <span className={styles.tBlock} />
        </div>
      );
    case 'citazione':
      return (
        <div className={`${styles.thumb} ${styles.tQuote}`}>
          <span className={styles.tQuoteMark}>“</span>
          <span className={styles.tQuoteText}>Il primo utente sei tu.</span>
          <span className={styles.tQuoteAuthor}>— {author}</span>
        </div>
      );
    case 'codice':
      return (
        <div className={`${styles.thumb} ${styles.tCode}`}>
          <span className={styles.tCodeTitle}>Snippet</span>
          <span className={`${styles.tCodeBox} mono`}>
            var x =
            <br />
            {'  '}Load();
          </span>
        </div>
      );
    case 'miniatura_yt':
      return (
        <div className={`${styles.thumb} ${styles.tYouTube}`}>
          <span className={styles.tYouTubeTitle}>
            IL MIO
            <br />
            CLIENT DB
          </span>
        </div>
      );
    case 'copertina_verticale':
      return (
        <div className={`${styles.thumb} ${styles.tVertical}`}>
          <span className={styles.tVerticalTitle}>Una riga, una settimana</span>
        </div>
      );
  }
}
