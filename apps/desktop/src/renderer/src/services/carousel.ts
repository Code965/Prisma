import {
  CAROUSEL_LIMITS,
  CAROUSEL_PLATFORMS,
  slideListItems,
  type Carousel,
  type Content,
  type Platform,
  type Slide,
  type Variant,
} from '@prisma-app/shared';

/** Operazioni sulle slide dell'editor: funzioni pure che restituiscono carosello e slide selezionata. */
export interface CarouselEdit {
  carousel: Carousel;
  index: number;
}

export function isCarouselPlatform(platform: Platform): boolean {
  return CAROUSEL_PLATFORMS.includes(platform);
}

const NEW_SLIDE: Slide = { kind: 'text', title: 'Nuova slide', body: '', code: '' };

/** Carosello di partenza «da zero»: copertina col titolo del contenuto, una slide, chiusura. */
export function starterCarousel(contentTitle: string): Carousel {
  return {
    template: 'scuro',
    kicker: '',
    slides: [
      {
        kind: 'cover',
        title: contentTitle.slice(0, CAROUSEL_LIMITS.titleRecommended),
        body: '',
        code: '',
      },
      { ...NEW_SLIDE, title: 'Il punto principale' },
      {
        kind: 'cta',
        title: 'Ti è stato utile?',
        body: 'Salva il post per quando ti serve.',
        code: '',
      },
    ],
  };
}

export function canAddSlide(carousel: Carousel): boolean {
  return carousel.slides.length < CAROUSEL_LIMITS.maxSlides;
}

/** Aggiunge una slide dopo quella selezionata e la seleziona. */
export function addSlide(carousel: Carousel, after: number): CarouselEdit {
  if (!canAddSlide(carousel)) return { carousel, index: after };
  const slides = [...carousel.slides];
  slides.splice(after + 1, 0, { ...NEW_SLIDE });
  return { carousel: { ...carousel, slides }, index: after + 1 };
}

export function removeSlide(carousel: Carousel, index: number): CarouselEdit {
  if (carousel.slides.length <= CAROUSEL_LIMITS.minSlides) return { carousel, index };
  const slides = carousel.slides.filter((_, i) => i !== index);
  return { carousel: { ...carousel, slides }, index: Math.min(index, slides.length - 1) };
}

export function moveSlide(carousel: Carousel, index: number, delta: -1 | 1): CarouselEdit {
  const target = index + delta;
  if (target < 0 || target >= carousel.slides.length) return { carousel, index };
  const slides = [...carousel.slides];
  [slides[index], slides[target]] = [slides[target]!, slides[index]!];
  return { carousel: { ...carousel, slides }, index: target };
}

export function patchSlide(carousel: Carousel, index: number, patch: Partial<Slide>): Carousel {
  return {
    ...carousel,
    slides: carousel.slides.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)),
  };
}

export function isCarouselChanged(draft: Carousel, saved: Carousel | undefined): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

/** Avvisi sulla slide (non bloccano il salvataggio): titolo lungo, elenco o codice vuoti. */
export function slideWarnings(slide: Slide): string[] {
  const warnings: string[] = [];
  if (!slide.title.trim()) warnings.push('Manca il titolo');
  if (slide.title.length > CAROUSEL_LIMITS.titleRecommended) {
    warnings.push(`Titolo oltre i ${CAROUSEL_LIMITS.titleRecommended} caratteri consigliati`);
  }
  if (slide.kind === 'list' && slideListItems(slide.body).length === 0) {
    warnings.push('Elenco senza punti: scrivine uno per riga');
  }
  if (slide.kind === 'code' && !slide.code.trim()) warnings.push('Manca il codice');
  return warnings;
}

/** Contenuti con almeno una variant che può diventare carosello (selettore dell'editor). */
export function carouselCandidates(contents: readonly Content[]): Array<{
  content: Content;
  variants: Variant[];
}> {
  return contents
    .map((content) => ({
      content,
      variants: content.variants.filter((v) => isCarouselPlatform(v.platform)),
    }))
    .filter((entry) => entry.variants.length > 0);
}
