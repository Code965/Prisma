import {
  BRAND_COLOR_LABELS,
  BRAND_COLOR_ROLES,
  TEMPLATE_DECORATIONS,
  TEMPLATE_DECORATION_LABELS,
  TEMPLATE_TITLE_SCALE,
  TEMPLATE_TONES,
  TEMPLATE_TONE_LABELS,
  type BrandColorRole,
  type BrandKit,
  type TemplateBackground,
  type TemplateStyle,
} from '@prisma-app/shared';
import { renderSlideHtml } from '@prisma-app/templates';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button } from '../../components/Button/Button';
import { SlideFrame } from '../../components/SlideFrame/SlideFrame';
import { slideFontFaceCss } from '../../components/SlideFrame/slide-fonts';
import { useBrand } from '../../hooks/brand';
import { useSaveBrandKit } from '../../hooks/useBrandKit';
import { errorMessage } from '../../services/api/client';
import { galleryCarousel } from '../../services/brand-kit';
import {
  BACKGROUND_TYPES,
  backgroundFileError,
  backgroundOfKind,
  draftError,
  prepareBackgroundImage,
  removeTemplate,
  saveTemplate,
  type TemplateDraft,
} from '../../services/template-editor';
import styles from './TemplateEditor.module.css';

/** Id fittizio per l'anteprima di un template non ancora salvato. */
const PREVIEW_ID = 'tpl-anteprim' as const;
const PREVIEW_WIDTH = 216;

interface TemplateEditorProps {
  /** Kit salvato (i template si salvano subito, il resto del kit resta com'è). */
  kit: BrandKit;
  /** Kit mostrato nell'anteprima, con le modifiche ancora in bozza (colori, font, logo). */
  shown: BrandKit;
  initial: TemplateDraft;
  onClose: () => void;
}

/**
 * Editor di un template (7c): a sinistra le impostazioni, a destra copertina, elenco e codice
 * disegnati dal vero renderer a ogni modifica.
 */
export function TemplateEditor({ kit, shown, initial, onClose }: TemplateEditorProps) {
  const { brand } = useBrand();
  const save = useSaveBrandKit();
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fontFaceCss = useMemo(() => slideFontFaceCss(), []);
  const error = draftError(draft, kit.templates);
  const style = draft.style;
  const setStyle = (patch: Partial<TemplateStyle>) =>
    setDraft((d) => ({ ...d, style: { ...d.style, ...patch } }));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const previewId = draft.id ?? PREVIEW_ID;
  const previewKit: BrandKit = {
    ...shown,
    templates: [
      ...kit.templates.filter((t) => t.id !== previewId),
      { id: previewId, name: draft.name || 'Anteprima', style },
    ],
  };
  const carousel = galleryCarousel(previewId);

  async function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = backgroundFileError(file);
    setImageError(problem);
    if (problem) return;
    try {
      const image = await prepareBackgroundImage(file);
      const dim = style.background.kind === 'image' ? style.background.dim : 0.55;
      setStyle({ background: { kind: 'image', image, dim } });
    } catch (err) {
      setImageError(errorMessage(err));
    }
  }

  function setBackgroundKind(kind: TemplateBackground['kind']) {
    if (kind === 'image' && style.background.kind !== 'image') {
      fileInput.current?.click();
      return;
    }
    setStyle({ background: backgroundOfKind(kind, style.background) });
  }

  function submit() {
    if (error) return;
    const result = saveTemplate(kit, draft);
    save.mutate(result.kit, { onSuccess: onClose });
  }

  function remove() {
    if (!draft.id) return;
    if (
      !window.confirm(
        `Eliminare il template «${draft.name}»? I caroselli che lo usano passano a Tech scuro.`,
      )
    ) {
      return;
    }
    save.mutate(removeTemplate(kit, draft.id), { onSuccess: onClose });
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="tpl-title">
      <div className={styles.card}>
        <header className={styles.header}>
          <h2 id="tpl-title" className={styles.title}>
            {draft.id ? 'Modifica template' : 'Nuovo template'}
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Chiudi
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.controls}>
            <label className={styles.field}>
              <span className={styles.label}>Nome</span>
              <input
                value={draft.name}
                maxLength={40}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={styles.input}
              />
            </label>

            <Choice
              label="Colori di base"
              hint="dal tuo brand kit"
              value={style.tone}
              options={TEMPLATE_TONES.map((tone) => ({
                value: tone,
                label: TEMPLATE_TONE_LABELS[tone],
              }))}
              onChange={(tone) => setStyle({ tone })}
            />

            <Choice
              label="Sfondo"
              value={style.background.kind}
              options={[
                { value: 'solid', label: 'Tinta unita' },
                { value: 'gradient', label: 'Sfumatura' },
                { value: 'image', label: 'Foto' },
              ]}
              onChange={setBackgroundKind}
            />
            <input
              ref={fileInput}
              type="file"
              accept={BACKGROUND_TYPES.join(',')}
              hidden
              onChange={(event) => void pickImage(event)}
            />
            {style.background.kind === 'gradient' ? (
              <GradientControls
                background={style.background}
                kit={shown}
                onChange={(background) => setStyle({ background })}
              />
            ) : null}
            {style.background.kind === 'image' ? (
              <div className={styles.sub}>
                <Range
                  label="Velo sopra la foto"
                  value={Math.round(style.background.dim * 100)}
                  min={0}
                  max={90}
                  unit="%"
                  onChange={(value) =>
                    style.background.kind === 'image' &&
                    setStyle({ background: { ...style.background, dim: value / 100 } })
                  }
                />
                <Button variant="secondary" size={32} onClick={() => fileInput.current?.click()}>
                  Cambia foto
                </Button>
              </div>
            ) : null}
            {imageError ? (
              <p role="alert" className={styles.error}>
                {imageError}
              </p>
            ) : null}

            <Choice
              label="Decorazione"
              value={style.decoration}
              options={TEMPLATE_DECORATIONS.map((d) => ({
                value: d,
                label: TEMPLATE_DECORATION_LABELS[d],
              }))}
              onChange={(decoration) => setStyle({ decoration })}
            />
            <Choice
              label="Logo e handle"
              value={style.logo}
              options={[
                { value: 'bottom', label: 'In basso' },
                { value: 'top', label: 'In alto' },
                { value: 'none', label: 'Nascosti' },
              ]}
              onChange={(logo) => setStyle({ logo })}
            />
            <Choice
              label="Numerazione"
              value={style.numbering}
              options={[
                { value: 'bottom', label: '2 / 5 in basso' },
                { value: 'top', label: 'In alto' },
                { value: 'progress', label: 'Barra' },
                { value: 'none', label: 'Nessuna' },
              ]}
              onChange={(numbering) => setStyle({ numbering })}
            />

            <div className={styles.field}>
              <span className={styles.label}>Titoli</span>
              <Range
                label="Dimensione"
                value={Math.round(style.titleScale * 100)}
                min={TEMPLATE_TITLE_SCALE.min * 100}
                max={TEMPLATE_TITLE_SCALE.max * 100}
                step={5}
                unit="%"
                onChange={(value) => setStyle({ titleScale: value / 100 })}
              />
              <div className={styles.row}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={style.uppercase}
                    onChange={(event) => setStyle({ uppercase: event.target.checked })}
                  />
                  Maiuscole
                </label>
                <Segmented
                  label="Allineamento"
                  value={style.align}
                  options={[
                    { value: 'left', label: 'A sinistra' },
                    { value: 'center', label: 'Al centro' },
                  ]}
                  onChange={(align) => setStyle({ align })}
                />
              </div>
            </div>
          </div>

          <div className={styles.preview} aria-label="Anteprima">
            {carousel.slides.map((slide, index) => (
              <SlideFrame
                key={slide.kind}
                width={PREVIEW_WIDTH}
                title={`Anteprima, slide ${index + 1}`}
                html={renderSlideHtml({
                  carousel,
                  index,
                  kit: previewKit,
                  initials: brand?.initials ?? '',
                  fontFaceCss,
                })}
              />
            ))}
            <p className={styles.hint}>
              Colori, font e logo vengono dal brand kit: se li cambi, il template li segue.
            </p>
          </div>
        </div>

        <footer className={styles.footer}>
          {draft.id ? (
            <Button variant="secondary" onClick={remove} disabled={save.isPending}>
              Elimina template
            </Button>
          ) : null}
          <span className={styles.spacer} />
          {error || save.error ? (
            <span role="alert" className={styles.error}>
              {error ?? errorMessage(save.error)}
            </span>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={submit} disabled={Boolean(error) || save.isPending}>
            {save.isPending ? 'Salvo…' : 'Salva template'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

interface Option<T extends string> {
  value: T;
  label: string;
}

function Choice<T extends string>(props: {
  label: string;
  hint?: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {props.label}
        {props.hint ? <span className={styles.labelHint}> · {props.hint}</span> : null}
      </span>
      <Segmented {...props} />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`${styles.segment} ${option.value === value ? styles.segmentOn : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Range(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
}): ReactNode {
  return (
    <label className={styles.range}>
      <span className={styles.rangeLabel}>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <span className={`${styles.rangeValue} mono`}>
        {props.value}
        {props.unit}
      </span>
    </label>
  );
}

function GradientControls({
  background,
  kit,
  onChange,
}: {
  background: Extract<TemplateBackground, { kind: 'gradient' }>;
  kit: BrandKit;
  onChange: (background: TemplateBackground) => void;
}) {
  const swatches = (key: 'from' | 'to') => (
    <div role="radiogroup" aria-label={key === 'from' ? 'Da' : 'A'} className={styles.swatches}>
      {BRAND_COLOR_ROLES.map((role: BrandColorRole) => (
        <button
          key={role}
          type="button"
          role="radio"
          aria-checked={background[key] === role}
          title={BRAND_COLOR_LABELS[role].name}
          aria-label={BRAND_COLOR_LABELS[role].name}
          className={`${styles.swatch} ${background[key] === role ? styles.swatchOn : ''}`}
          style={{ background: kit.colors[role] }}
          onClick={() => onChange({ ...background, [key]: role })}
        />
      ))}
    </div>
  );
  return (
    <div className={styles.sub}>
      <div className={styles.row}>
        <span className={styles.rangeLabel}>Da</span>
        {swatches('from')}
        <span className={styles.rangeLabel}>a</span>
        {swatches('to')}
      </div>
      <Range
        label="Direzione"
        value={background.angle}
        min={0}
        max={360}
        step={5}
        unit="°"
        onChange={(angle) => onChange({ ...background, angle })}
      />
    </div>
  );
}
