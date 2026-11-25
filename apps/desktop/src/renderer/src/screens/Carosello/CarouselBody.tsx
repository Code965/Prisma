import {
  CAROUSEL_LIMITS,
  resolveTemplate,
  templateChoices,
  type TemplateId,
  PLATFORM_LABELS,
  type Carousel,
  type Content,
  type Variant,
} from '@prisma-app/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Page } from '../../components/Page/Page';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { SlideFrame } from '../../components/SlideFrame/SlideFrame';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { useBrandKit } from '../../hooks/useBrandKit';
import { useExportCarousel } from '../../hooks/useExport';
import { useSlideRenderer } from '../../hooks/useSlideRenderer';
import { useSaveVariant } from '../../hooks/useStudio';
import { errorMessage } from '../../services/api/client';
import {
  addSlide,
  canAddSlide,
  isCarouselChanged,
  moveSlide,
  patchSlide,
  removeSlide,
  type CarouselEdit,
} from '../../services/carousel';
import { templateSwatch } from '../../services/brand-kit';
import { canExportHere } from '../../services/exports';
import { isReadOnly } from '../../services/studio';
import styles from './Carosello.module.css';
import { CarouselChat, type ChatEntry } from './CarouselChat';
import { ExportButtons, ExportPanel } from './ExportControls';
import { SlideFields } from './SlideFields';

interface CarouselBodyProps {
  content: Content;
  variant: Variant;
  saved: Carousel;
  selected: number;
  onSelect: (index: number) => void;
  chat: ChatEntry[];
  onChat: (update: (chat: ChatEntry[]) => ChatEntry[]) => void;
}

const PREVIEW_WIDTH = 432;
const THUMB_WIDTH = 140;

/** Editor con la bozza locale delle slide: miniature, anteprima grande, campi e chat. */
export function CarouselBody(props: CarouselBodyProps) {
  const { content, variant, saved, selected, onSelect } = props;
  const [draft, setDraft] = useState<Carousel>(saved);
  const render = useSlideRenderer();
  const kit = useBrandKit().data;
  const choices = templateChoices(kit?.templates);
  const save = useSaveVariant(content.id);
  const readOnly = isReadOnly(variant.status);
  const dirty = isCarouselChanged(draft, saved);
  const exporter = useExportCarousel(variant);
  const slide = draft.slides[selected] ?? draft.slides[0]!;

  const apply = (edit: CarouselEdit) => {
    setDraft(edit.carousel);
    onSelect(edit.index);
  };

  return (
    <Page
      breadcrumb={
        <>
          <Link to={`/studio/${content.id}`}>{content.title}</Link> / Carosello
        </>
      }
      title="Editor carosello"
      titleExtra={
        <span className={styles.variantTag}>
          <PlatformIcon platform={variant.platform} size={20} />
          {PLATFORM_LABELS[variant.platform]}
          <StatusPill status={variant.status} />
        </span>
      }
      actions={
        <div className={styles.headerActions}>
          <label className={styles.templates}>
            <span className={styles.templatesLabel}>Template</span>
            <span
              aria-hidden
              className={styles.swatch}
              style={{ background: kit ? templateSwatch(draft.template, kit) : undefined }}
            />
            <select
              value={resolveTemplate(draft.template, kit?.templates).id}
              disabled={readOnly}
              className={styles.templateSelect}
              onChange={(event) =>
                setDraft({ ...draft, template: event.target.value as TemplateId })
              }
            >
              <optgroup label="Stili pronti">
                {choices
                  .filter((choice) => !choice.custom)
                  .map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
              </optgroup>
              {choices.some((choice) => choice.custom) ? (
                <optgroup label="I tuoi template">
                  {choices
                    .filter((choice) => choice.custom)
                    .map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <ExportButtons
            exporter={exporter}
            platform={variant.platform}
            blockedReason={
              !canExportHere()
                ? 'L’export funziona nell’app desktop'
                : dirty
                  ? 'Salva il carosello prima di esportarlo'
                  : !kit
                    ? 'Carico il brand kit…'
                    : null
            }
          />
        </div>
      }
    >
      <div className={styles.workspace}>
        <section aria-labelledby="h-slides" className={styles.slides}>
          <h2 id="h-slides" className={styles.slidesTitle}>
            Slide · {draft.slides.length}
          </h2>
          {draft.slides.map((s, index) => (
            <button
              key={index}
              type="button"
              aria-pressed={index === selected}
              aria-label={`Slide ${index + 1}: ${s.title}`}
              className={`${styles.thumb} ${index === selected ? styles.thumbOn : ''}`}
              onClick={() => onSelect(index)}
            >
              <span className={`${styles.thumbNumber} mono`}>{index + 1}</span>
              <SlideFrame
                html={render(draft, index)}
                width={THUMB_WIDTH}
                title={`Miniatura slide ${index + 1}`}
              />
            </button>
          ))}
          {!readOnly && (
            <button
              type="button"
              className={styles.addSlide}
              disabled={!canAddSlide(draft)}
              onClick={() => apply(addSlide(draft, selected))}
            >
              {canAddSlide(draft)
                ? '+ Aggiungi slide'
                : `Massimo ${CAROUSEL_LIMITS.maxSlides} slide`}
            </button>
          )}
        </section>

        <section aria-label={`Anteprima slide ${selected + 1}`} className={styles.canvas}>
          <div className={styles.previewShadow}>
            <SlideFrame
              html={render(draft, selected)}
              width={PREVIEW_WIDTH}
              title={`Slide ${selected + 1}`}
            />
          </div>
          <span className={`${styles.canvasCaption} mono`}>
            1080 × 1350 px · 4:5 · anteprima al 40%
          </span>
        </section>

        <aside className={styles.aside}>
          <SlideFields
            carousel={draft}
            index={selected}
            slide={slide}
            readOnly={readOnly}
            onChange={setDraft}
            onMove={(delta) => apply(moveSlide(draft, selected, delta))}
            onRemove={() => apply(removeSlide(draft, selected))}
          />
          <div className={styles.saveBox}>
            {readOnly ? (
              <p className={styles.note}>
                Bozza in coda o già pubblicata: per modificarla annulla prima la programmazione.
              </p>
            ) : (
              <>
                <Button
                  disabled={!dirty || save.isPending}
                  onClick={() =>
                    save.mutate({
                      variant,
                      draft: {
                        body: variant.body,
                        metadata: { ...variant.metadata, carousel: draft },
                      },
                    })
                  }
                >
                  {save.isPending ? 'Salvo…' : 'Salva carosello'}
                </Button>
                {dirty && (
                  <Button variant="secondary" onClick={() => setDraft(saved)}>
                    Annulla modifiche
                  </Button>
                )}
              </>
            )}
            {save.error ? (
              <p role="alert" className={styles.error}>
                {errorMessage(save.error)}
              </p>
            ) : null}
          </div>
          <ExportPanel exporter={exporter} variantId={variant.id} />
          <CarouselChat
            contentId={content.id}
            variant={variant}
            index={selected}
            dirty={dirty}
            readOnly={readOnly}
            entries={props.chat}
            onEntries={props.onChat}
            onUseTitle={(title) => setDraft(patchSlide(draft, selected, { title }))}
          />
        </aside>
      </div>
    </Page>
  );
}
