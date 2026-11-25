import {
  BRAND_COLOR_LABELS,
  BRAND_COLOR_ROLES,
  CODE_FONT_IDS,
  LOGO_MAX_BYTES,
  PLATFORM_LABELS,
  TEXT_FONT_IDS,
  type BrandColorRole,
  resolveTemplate,
  type BrandKit,
  type Carousel,
  type TemplateId,
  type SlideFontId,
  type VoiceExample,
} from '@prisma-app/shared';
import { tonePalette } from '@prisma-app/templates';

/** Parte del kit modificata nel pannello «Brand kit» (le regole della voce si salvano subito). */
export type KitDraft = Pick<BrandKit, 'colors' | 'handle' | 'logo' | 'videoTemplate' | 'fonts'>;

export function kitDraft(kit: BrandKit): KitDraft {
  return {
    colors: { ...kit.colors },
    handle: kit.handle,
    logo: kit.logo,
    videoTemplate: kit.videoTemplate,
    fonts: { ...kit.fonts },
  };
}

export function isDraftChanged(draft: KitDraft, kit: BrandKit): boolean {
  return (
    draft.handle.trim().replace(/^@+/, '') !== kit.handle ||
    draft.logo !== kit.logo ||
    draft.videoTemplate !== kit.videoTemplate ||
    FONT_ROLES.some((role) => draft.fonts[role] !== kit.fonts[role]) ||
    BRAND_COLOR_ROLES.some((role) => draft.colors[role].toUpperCase() !== kit.colors[role])
  );
}

/** Ruoli dei font nel kit, con il nome mostrato e i font fra cui scegliere. */
export const FONT_ROLES = ['heading', 'body', 'code'] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const FONT_ROLE_INFO: Record<
  FontRole,
  { label: string; use: string; options: readonly SlideFontId[] }
> = {
  heading: { label: 'Titoli', use: 'copertine e titoli delle slide', options: TEXT_FONT_IDS },
  body: { label: 'Testo', use: 'testo, elenchi e handle', options: TEXT_FONT_IDS },
  code: { label: 'Codice', use: 'codice, numeri ed etichette', options: CODE_FONT_IDS },
};

/** Testo di prova di un font: «Aa» per i titoli, una riga di codice per il codice. */
export function fontSample(role: FontRole): string {
  return role === 'code' ? '{ 0O1l }' : 'Aa';
}

export interface ColorRow {
  role: BrandColorRole;
  name: string;
  use: string;
  hex: string;
}

export function colorRows(colors: BrandKit['colors']): ColorRow[] {
  return BRAND_COLOR_ROLES.map((role) => ({
    role,
    ...BRAND_COLOR_LABELS[role],
    hex: colors[role].toUpperCase(),
  }));
}

/** Aggiunge una regola della voce ignorando vuoti e doppioni (senza distinguere maiuscole). */
export function addRule(rules: readonly string[], rule: string): string[] {
  const clean = rule.trim().replace(/\s+/g, ' ');
  if (!clean || rules.some((r) => r.toLowerCase() === clean.toLowerCase())) return [...rules];
  return [...rules, clean];
}

export function removeRule(rules: readonly string[], rule: string): string[] {
  return rules.filter((r) => r !== rule);
}

export function voiceExampleMeta(example: VoiceExample): string {
  const kind =
    example.platform === 'blog' ? 'Articolo del blog' : `Post ${PLATFORM_LABELS[example.platform]}`;
  return example.note ? `${kind} · ${example.note}` : kind;
}

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Controllo del file scelto come logo prima di leggerlo; null se va bene. */
export function logoFileError(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Il logo deve essere PNG, JPEG, WebP o SVG';
  if (file.size > LOGO_MAX_BYTES) return 'Il logo supera 256 KB';
  return null;
}

/**
 * Carosello di prova della galleria (7a): copertina, elenco e codice, disegnati con il vero
 * renderer delle slide, così colori, font, logo e handle del kit si vedono come nell'export.
 */
export function galleryCarousel(template: TemplateId): Carousel {
  return {
    template,
    kicker: 'prisma',
    slides: [
      {
        kind: 'cover',
        title: 'Un’idea, quattro piattaforme',
        body: 'Come scrivo una volta sola',
        code: '',
      },
      {
        kind: 'list',
        title: 'Tre regole che uso',
        body: 'Una idea per post\nEsempi dal lavoro vero\nSempre una domanda finale',
        code: '',
      },
      {
        kind: 'code',
        title: 'Il trucco',
        body: 'Una riga al giorno.',
        code: 'const post = await idea\n  .toDraft("linkedin");',
      },
    ],
  };
}

/** Il kit mostrato nella galleria: quello salvato con le modifiche ancora in bozza. */
export function draftKit(kit: BrandKit, draft: KitDraft): BrandKit {
  return { ...kit, ...draft, handle: draft.handle.trim().replace(/^@+/, '') };
}

/** Campione di un template per i selettori: il suo fondo (anche sfumato) con i colori del kit. */
export function templateSwatch(
  id: TemplateId,
  kit: Pick<BrandKit, 'colors' | 'templates'>,
): string {
  const { style } = resolveTemplate(id, kit.templates);
  const bg = style.background;
  if (bg.kind === 'gradient') {
    return `linear-gradient(${bg.angle}deg, ${kit.colors[bg.from]}, ${kit.colors[bg.to]})`;
  }
  return tonePalette(style.tone, kit.colors).bg;
}
