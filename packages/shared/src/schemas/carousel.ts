import { z } from 'zod';

/**
 * Carosello (V3Carosello): slide in JSON dentro `metadata.carousel` della variant, così valgono
 * versioni, revisioni e la regola fondamentale (ogni modifica riporta la variant a `bozza`).
 * Il rendering 1080×1350 è in `@prisma-app/templates`.
 */

export const SLIDE_KINDS = ['cover', 'text', 'list', 'code', 'cta'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

export const SLIDE_KIND_LABELS: Record<SlideKind, string> = {
  cover: 'Copertina',
  text: 'Titolo e testo',
  list: 'Elenco',
  code: 'Snippet di codice',
  cta: 'Chiusura',
};

export const CAROUSEL_TEMPLATES = ['scuro', 'chiaro', 'codice'] as const;
export type CarouselTemplate = (typeof CAROUSEL_TEMPLATES)[number];

export const CAROUSEL_TEMPLATE_LABELS: Record<CarouselTemplate, string> = {
  scuro: 'Tech scuro',
  chiaro: 'Minimal chiaro',
  codice: 'Terminale',
};

/**
 * Limiti dell'editor. Titolo consigliato ≤ 60 caratteri (contatore del mockup), massimo duro più
 * largo per non perdere testo durante la modifica. Numero di slide da riverificare con
 * l'adapter Instagram (fase 2f).
 */
export const CAROUSEL_LIMITS = {
  minSlides: 1,
  maxSlides: 10,
  titleRecommended: 60,
  titleMax: 120,
  bodyMax: 600,
  codeMax: 1500,
  kickerMax: 40,
} as const;

export const SlideSchema = z.object({
  kind: z.enum(SLIDE_KINDS),
  title: z.string().trim().max(CAROUSEL_LIMITS.titleMax),
  /** Negli elenchi: una riga per punto. */
  body: z.string().max(CAROUSEL_LIMITS.bodyMax).default(''),
  code: z.string().max(CAROUSEL_LIMITS.codeMax).default(''),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CarouselSchema = z.object({
  template: z.enum(CAROUSEL_TEMPLATES).default('scuro'),
  /** Etichetta in alto in ogni slide (es. "client-db"): "// client-db" o "$ cat client-db". */
  kicker: z.string().trim().max(CAROUSEL_LIMITS.kickerMax).default(''),
  slides: z.array(SlideSchema).min(CAROUSEL_LIMITS.minSlides).max(CAROUSEL_LIMITS.maxSlides),
});
export type Carousel = z.infer<typeof CarouselSchema>;

/** Punti di una slide elenco: righe non vuote del testo. */
export function slideListItems(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
