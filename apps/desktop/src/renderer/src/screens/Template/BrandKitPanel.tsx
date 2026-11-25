import {
  CAROUSEL_TEMPLATES,
  CAROUSEL_TEMPLATE_LABELS,
  SLIDE_FONTS,
  fontStack,
  type BrandKit,
} from '@prisma-app/shared';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/Button/Button';
import { slideFontFaceCss } from '../../components/SlideFrame/slide-fonts';
import { useBrand } from '../../hooks/brand';
import { useSaveBrandKit } from '../../hooks/useBrandKit';
import { errorMessage } from '../../services/api/client';
import {
  FONT_ROLES,
  FONT_ROLE_INFO,
  LOGO_TYPES,
  colorRows,
  fontSample,
  isDraftChanged,
  kitDraft,
  logoFileError,
  type KitDraft,
} from '../../services/brand-kit';
import { readAsDataUrl } from '../../services/files';
import styles from './Template.module.css';

interface BrandKitPanelProps {
  kit: BrandKit;
  draft: KitDraft;
  onChange: (draft: KitDraft) => void;
}

/** Colori, font, logo e handle. Le modifiche restano in bozza finché non le salvi. */
export function BrandKitPanel({ kit, draft, onChange }: BrandKitPanelProps) {
  const { brand } = useBrand();
  const save = useSaveBrandKit();
  const fileInput = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const changed = isDraftChanged(draft, kit);
  // I font delle slide anche nella pagina, per mostrare ogni nome scritto nel suo font.
  const fontFaces = useMemo(() => slideFontFaceCss(), []);

  async function pickLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const error = logoFileError(file);
    setLogoError(error);
    if (!error) onChange({ ...draft, logo: await readAsDataUrl(file) });
  }

  return (
    <section aria-labelledby="h-kit" className={`${styles.panel} ${styles.kitPanel}`}>
      <h2 id="h-kit" className={styles.h2}>
        Brand kit
      </h2>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Colori</span>
        <div className={styles.colors}>
          {colorRows(draft.colors).map((color) => (
            <label key={color.role} className={styles.color} title={`Usato per ${color.use}`}>
              <span className={styles.swatch} style={{ background: color.hex }}>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={color.hex.toLowerCase()}
                  aria-label={`${color.name} (${color.use})`}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      colors: { ...draft.colors, [color.role]: event.target.value.toUpperCase() },
                    })
                  }
                />
              </span>
              <span className={styles.colorName}>{color.name}</span>
              <span className={`${styles.colorHex} mono`}>{color.hex}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Font</span>
        <style>{fontFaces}</style>
        {FONT_ROLES.map((role) => {
          const info = FONT_ROLE_INFO[role];
          return (
            <div key={role} className={styles.fontPick}>
              <div className={styles.fontPickHead}>
                <span className={styles.fontRole}>{info.label}</span>
                <span className={styles.hint}>{info.use}</span>
              </div>
              <div
                role="radiogroup"
                aria-label={`Font: ${info.label}`}
                className={styles.fontOptions}
              >
                {info.options.map((id) => {
                  const on = draft.fonts[role] === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`${styles.fontOption} ${on ? styles.fontOptionOn : ''}`}
                      onClick={() => onChange({ ...draft, fonts: { ...draft.fonts, [role]: id } })}
                    >
                      <span
                        className={`${styles.fontSample} ${role === 'code' ? styles.fontSampleCode : ''}`}
                        style={{
                          fontFamily: fontStack(id),
                          fontWeight: role === 'heading' ? SLIDE_FONTS[id].titleWeight : 400,
                        }}
                      >
                        {fontSample(role)}
                      </span>
                      <span className={styles.fontName}>{SLIDE_FONTS[id].label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <span className={styles.hint}>
          Font open source inclusi nell’app: valgono per caroselli, schede e slide dei video.
        </span>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Logo</span>
        <div className={styles.logoRow}>
          <LogoTile
            logo={draft.logo}
            initials={brand?.initials ?? ''}
            dark
            ink={draft.colors.ink}
            paper={draft.colors.paper}
          />
          <LogoTile
            logo={draft.logo}
            initials={brand?.initials ?? ''}
            dark={false}
            ink={draft.colors.ink}
            paper={draft.colors.paper}
          />
          <button
            type="button"
            className={styles.dashed}
            onClick={() => fileInput.current?.click()}
          >
            {draft.logo ? 'Cambia logo' : 'Carica SVG o PNG'}
          </button>
          {draft.logo && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => onChange({ ...draft, logo: null })}
            >
              Rimuovi
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={LOGO_TYPES.join(',')}
            hidden
            onChange={(event) => void pickLogo(event)}
          />
        </div>
        {logoError && (
          <p role="alert" className={styles.error}>
            {logoError}
          </p>
        )}
      </div>

      <div className={styles.group}>
        <label htmlFor="kit-handle" className={styles.groupLabel}>
          Handle nelle slide
        </label>
        <div className={styles.handle}>
          <span className={`${styles.handleAt} mono`}>@</span>
          <input
            id="kit-handle"
            className={styles.input}
            value={draft.handle}
            maxLength={60}
            placeholder="tuohandle"
            onChange={(event) => onChange({ ...draft, handle: event.target.value })}
          />
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Template dei video</span>
        <div role="group" aria-label="Template dei video" className={styles.videoTemplates}>
          {CAROUSEL_TEMPLATES.map((template) => (
            <button
              key={template}
              type="button"
              aria-pressed={draft.videoTemplate === template}
              className={`${styles.videoTemplate} ${draft.videoTemplate === template ? styles.videoTemplateOn : ''}`}
              onClick={() => onChange({ ...draft, videoTemplate: template })}
            >
              {CAROUSEL_TEMPLATE_LABELS[template]}
            </button>
          ))}
        </div>
        <span className={styles.hint}>
          Slide di «Crea video», schede di testo e fondo attorno allo schermo registrato. Il codice
          usa sempre «Terminale».
        </span>
      </div>

      <div className={styles.saveRow}>
        <Button
          size={36}
          disabled={!changed || save.isPending}
          onClick={() =>
            save.mutate({ ...kit, ...draft }, { onSuccess: (saved) => onChange(kitDraft(saved)) })
          }
        >
          {save.isPending ? 'Salvo…' : 'Salva brand kit'}
        </Button>
        {changed && (
          <Button variant="secondary" size={36} onClick={() => onChange(kitDraft(kit))}>
            Annulla modifiche
          </Button>
        )}
        {!changed && save.isSuccess && <span className={styles.ok}>Salvato</span>}
      </div>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      ) : null}
    </section>
  );
}

interface LogoTileProps {
  logo: string | null;
  initials: string;
  dark: boolean;
  ink: string;
  paper: string;
}

/** Il logo su sfondo scuro e chiaro, come apparirà nelle slide; senza logo, le iniziali. */
function LogoTile({ logo, initials, dark, ink, paper }: LogoTileProps) {
  return (
    <span
      className={`${styles.logoTile} mono`}
      style={{ background: dark ? ink : paper, color: dark ? paper : ink }}
      aria-label={dark ? 'Logo su sfondo scuro' : 'Logo su sfondo chiaro'}
    >
      {logo ? <img src={logo} alt="" className={styles.logoImg} /> : initials}
    </span>
  );
}
