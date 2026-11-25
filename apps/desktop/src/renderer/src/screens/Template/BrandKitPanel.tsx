import { CAROUSEL_TEMPLATES, CAROUSEL_TEMPLATE_LABELS, type BrandKit } from '@prisma-app/shared';
import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/Button/Button';
import { useBrand } from '../../hooks/brand';
import { useSaveBrandKit } from '../../hooks/useBrandKit';
import { errorMessage } from '../../services/api/client';
import {
  LOGO_TYPES,
  colorRows,
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
        <div className={styles.fontRow}>
          <span className={styles.fontSans}>Inter</span>
          <span className={styles.hint}>titoli e testo</span>
        </div>
        <div className={styles.fontRow}>
          <span className={`${styles.fontMono} mono`}>JetBrains Mono</span>
          <span className={styles.hint}>codice ed etichette</span>
        </div>
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
