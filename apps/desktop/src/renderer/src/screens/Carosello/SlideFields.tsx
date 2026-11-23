import {
  CAROUSEL_LIMITS,
  SLIDE_KINDS,
  SLIDE_KIND_LABELS,
  type Carousel,
  type Slide,
  type SlideKind,
} from '@prisma-app/shared';
import { patchSlide, slideWarnings } from '../../services/carousel';
import styles from './Carosello.module.css';

interface SlideFieldsProps {
  carousel: Carousel;
  index: number;
  slide: Slide;
  readOnly: boolean;
  onChange: (carousel: Carousel) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/** Campi della slide selezionata (V3Carosello): layout, titolo, testo, codice ed etichetta. */
export function SlideFields({
  carousel,
  index,
  slide,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: SlideFieldsProps) {
  const patch = (values: Partial<Slide>) => onChange(patchSlide(carousel, index, values));
  const warnings = slideWarnings(slide);
  const last = carousel.slides.length - 1;

  return (
    <section aria-labelledby="h-campi" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="h-campi" className={styles.panelTitle}>
          Slide {index + 1}
        </h2>
        {!readOnly && (
          <div className={styles.slideActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Sposta la slide prima"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Sposta la slide dopo"
              disabled={index === last}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Elimina la slide"
              disabled={carousel.slides.length <= CAROUSEL_LIMITS.minSlides}
              onClick={onRemove}
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="sl-kind" className={styles.label}>
          Layout
        </label>
        <select
          id="sl-kind"
          className={styles.input}
          value={slide.kind}
          disabled={readOnly}
          onChange={(event) => patch({ kind: event.target.value as SlideKind })}
        >
          {SLIDE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SLIDE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <label htmlFor="sl-title" className={styles.label}>
            Titolo
          </label>
          <span
            className={`${styles.counter} mono`}
            data-over={slide.title.length > CAROUSEL_LIMITS.titleRecommended || undefined}
          >
            {slide.title.length} / {CAROUSEL_LIMITS.titleRecommended}
          </span>
        </div>
        <input
          id="sl-title"
          className={styles.input}
          value={slide.title}
          maxLength={CAROUSEL_LIMITS.titleMax}
          readOnly={readOnly}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="sl-body" className={styles.label}>
          Testo <span className={styles.labelHint}>(una riga per punto, negli elenchi)</span>
        </label>
        <textarea
          id="sl-body"
          rows={4}
          className={styles.textarea}
          value={slide.body}
          maxLength={CAROUSEL_LIMITS.bodyMax}
          readOnly={readOnly}
          onChange={(event) => patch({ body: event.target.value })}
        />
      </div>

      {slide.kind === 'code' && (
        <div className={styles.field}>
          <label htmlFor="sl-code" className={styles.label}>
            Codice
          </label>
          <textarea
            id="sl-code"
            rows={4}
            className={`${styles.textarea} mono`}
            value={slide.code}
            maxLength={CAROUSEL_LIMITS.codeMax}
            readOnly={readOnly}
            spellCheck={false}
            onChange={(event) => patch({ code: event.target.value })}
          />
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="sl-kicker" className={styles.label}>
          Etichetta in alto <span className={styles.labelHint}>(tutte le slide)</span>
        </label>
        <input
          id="sl-kicker"
          className={`${styles.input} mono`}
          value={carousel.kicker}
          maxLength={CAROUSEL_LIMITS.kickerMax}
          placeholder="client-db"
          readOnly={readOnly}
          onChange={(event) => onChange({ ...carousel, kicker: event.target.value })}
        />
      </div>

      {warnings.length > 0 && (
        <ul className={styles.warnings}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
