import { z } from 'zod';
import { BRAND_COLOR_ROLES } from './brand-colors.js';
import {
  CAROUSEL_TEMPLATE_LABELS,
  CustomTemplateIdSchema,
  isBuiltinTemplate,
  type CarouselTemplate,
  type TemplateId,
} from './carousel.js';

/**
 * Modello di un template (fase 7b): tutto ciò che cambia l'aspetto delle slide oltre al brand
 * kit. Gli stili pronti e i template creati dall'utente sono fatti allo stesso modo; i colori
 * sono sempre ruoli del kit, così un template segue il brand anche se i colori cambiano.
 */

/** Base dei colori: da quale combinazione del kit nascono testo, accento e codice. */
export const TEMPLATE_TONES = ['scuro', 'chiaro', 'codice', 'accento'] as const;
export type TemplateTone = (typeof TEMPLATE_TONES)[number];

export const TEMPLATE_TONE_LABELS: Record<TemplateTone, string> = {
  scuro: 'Scuro',
  chiaro: 'Chiaro',
  codice: 'Terminale',
  accento: 'Colore accento',
};

export const TEMPLATE_DECORATIONS = ['none', 'blob', 'grid', 'dots', 'corner', 'rule'] as const;
export type TemplateDecoration = (typeof TEMPLATE_DECORATIONS)[number];

export const TEMPLATE_DECORATION_LABELS: Record<TemplateDecoration, string> = {
  none: 'Nessuna',
  blob: 'Bagliore',
  grid: 'Griglia',
  dots: 'Puntini',
  corner: 'Angolo',
  rule: 'Filetto',
};

/** Dove va il segno del brand (logo o iniziali) con l'handle. */
export const TEMPLATE_LOGO_POSITIONS = ['bottom', 'top', 'none'] as const;
export type TemplateLogoPosition = (typeof TEMPLATE_LOGO_POSITIONS)[number];

/** Numerazione delle slide: «3 / 8» in basso o in alto, barra di avanzamento o niente. */
export const TEMPLATE_NUMBERINGS = ['bottom', 'top', 'progress', 'none'] as const;
export type TemplateNumbering = (typeof TEMPLATE_NUMBERINGS)[number];

/** Immagine di sfondo come data URL (≤ 600 KB): l'export non dipende da file esterni. */
export const BACKGROUND_IMAGE_MAX_BYTES = 600 * 1024;
export const BackgroundImageSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, 'Immagine PNG, JPEG o WebP')
  .refine(
    (url) =>
      Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4) <= BACKGROUND_IMAGE_MAX_BYTES,
    { message: 'L’immagine supera 600 KB' },
  );

const ColorRoleSchema = z.enum(BRAND_COLOR_ROLES);

export const TemplateBackgroundSchema = z.discriminatedUnion('kind', [
  /** Il colore di fondo del tono. */
  z.object({ kind: z.literal('solid') }),
  z.object({
    kind: z.literal('gradient'),
    from: ColorRoleSchema,
    to: ColorRoleSchema,
    angle: z.number().int().min(0).max(360),
  }),
  z.object({
    kind: z.literal('image'),
    image: BackgroundImageSchema,
    /** Velo del colore di fondo sopra la foto, perché il testo resti leggibile. */
    dim: z.number().min(0).max(0.9),
  }),
]);
export type TemplateBackground = z.infer<typeof TemplateBackgroundSchema>;

export const TEMPLATE_TITLE_SCALE = { min: 0.8, max: 1.3 } as const;

export const TemplateStyleSchema = z.object({
  tone: z.enum(TEMPLATE_TONES),
  background: TemplateBackgroundSchema,
  decoration: z.enum(TEMPLATE_DECORATIONS),
  logo: z.enum(TEMPLATE_LOGO_POSITIONS),
  numbering: z.enum(TEMPLATE_NUMBERINGS),
  /** Dimensione dei titoli rispetto a quella del template di base. */
  titleScale: z.number().min(TEMPLATE_TITLE_SCALE.min).max(TEMPLATE_TITLE_SCALE.max),
  uppercase: z.boolean(),
  align: z.enum(['left', 'center']),
});
export type TemplateStyle = z.infer<typeof TemplateStyleSchema>;

/** Lo stile di Tech scuro: con questi valori le slide sono identiche a quelle di prima. */
export const DEFAULT_TEMPLATE_STYLE: TemplateStyle = {
  tone: 'scuro',
  background: { kind: 'solid' },
  decoration: 'none',
  logo: 'bottom',
  numbering: 'bottom',
  titleScale: 1,
  uppercase: false,
  align: 'left',
};

export const BUILTIN_TEMPLATE_STYLES: Record<CarouselTemplate, TemplateStyle> = {
  scuro: DEFAULT_TEMPLATE_STYLE,
  chiaro: { ...DEFAULT_TEMPLATE_STYLE, tone: 'chiaro' },
  codice: { ...DEFAULT_TEMPLATE_STYLE, tone: 'codice' },
  gradiente: {
    ...DEFAULT_TEMPLATE_STYLE,
    background: { kind: 'gradient', from: 'ink', to: 'accent', angle: 155 },
    decoration: 'blob',
    numbering: 'progress',
    titleScale: 1.05,
  },
  editoriale: {
    ...DEFAULT_TEMPLATE_STYLE,
    tone: 'chiaro',
    decoration: 'rule',
    logo: 'top',
    numbering: 'top',
    titleScale: 1.1,
    align: 'center',
  },
  bold: {
    ...DEFAULT_TEMPLATE_STYLE,
    tone: 'accento',
    decoration: 'corner',
    titleScale: 1.15,
    uppercase: true,
  },
  griglia: { ...DEFAULT_TEMPLATE_STYLE, decoration: 'grid', numbering: 'progress' },
};

export const CustomTemplateSchema = z.object({
  id: CustomTemplateIdSchema,
  name: z.string().trim().min(1).max(40),
  style: TemplateStyleSchema,
});
export type CustomTemplate = z.infer<typeof CustomTemplateSchema>;

export interface ResolvedTemplate {
  id: TemplateId;
  label: string;
  style: TemplateStyle;
  custom: boolean;
}

/**
 * Lo stile di un template: pronto o del kit. Un template del kit eliminato torna a Tech scuro
 * (il carosello resta valido, solo l'aspetto cambia).
 */
export function resolveTemplate(
  id: TemplateId,
  templates: readonly CustomTemplate[] | undefined,
): ResolvedTemplate {
  if (isBuiltinTemplate(id)) {
    return {
      id,
      label: CAROUSEL_TEMPLATE_LABELS[id],
      style: BUILTIN_TEMPLATE_STYLES[id],
      custom: false,
    };
  }
  const custom = templates?.find((template) => template.id === id);
  if (custom) return { id, label: custom.name, style: custom.style, custom: true };
  return {
    id: 'scuro',
    label: CAROUSEL_TEMPLATE_LABELS.scuro,
    style: DEFAULT_TEMPLATE_STYLE,
    custom: false,
  };
}

/** Stili pronti e poi quelli del kit, per i selettori. */
export function templateChoices(
  templates: readonly CustomTemplate[] | undefined,
): Array<{ id: TemplateId; label: string; custom: boolean }> {
  return [
    ...(Object.keys(BUILTIN_TEMPLATE_STYLES) as CarouselTemplate[]).map((id) => ({
      id,
      label: CAROUSEL_TEMPLATE_LABELS[id],
      custom: false,
    })),
    ...(templates ?? []).map((t) => ({ id: t.id, label: t.name, custom: true })),
  ];
}
