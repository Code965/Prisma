import { slideListItems, type BrandKit, type Carousel, type Slide } from '@prisma-app/shared';
import { templatePalette, type Palette } from './palette.js';

/** Formato delle slide: 4:5, quello consigliato per i caroselli di Instagram e LinkedIn. */
export const SLIDE_SIZE = { width: 1080, height: 1350 } as const;

export interface SlideContext {
  carousel: Carousel;
  /** Indice della slide da disegnare (da 0). */
  index: number;
  kit: BrandKit;
  /** Iniziali del brand, usate al posto del logo se manca. */
  initials: string;
  /**
   * Regole `@font-face` per Inter e JetBrains Mono, fornite da chi disegna (renderer o main di
   * Electron) con gli indirizzi dei font inclusi nell'app. Senza, si usano i font di sistema.
   */
  fontFaceCss?: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Documento HTML completo di una slide 1080×1350, con CSS inline e nessuno script (la CSP lo
 * vieta comunque). Misure del mockup (anteprima al 40%) moltiplicate per 2,5.
 */
export function renderSlideHtml(context: SlideContext): string {
  const { carousel, index, kit } = context;
  if (!carousel.slides[index]) throw new RangeError(`Slide ${index + 1} inesistente`);
  const palette = templatePalette(carousel.template, kit.colors);
  // Una slide sola non scorre mai: niente barre anche se la finestra è più piccola.
  const singleCss = 'html,body{overflow:hidden}';
  return documentHtml(
    context.fontFaceCss,
    slideCss(palette) + singleCss,
    slideMarkup(context, index),
  );
}

/**
 * Tutte le slide in un solo documento, una per pagina 1080×1350: è il PDF dei caroselli di
 * LinkedIn (stampato da Electron con `preferCSSPageSize`).
 */
export function renderCarouselPdfHtml(context: Omit<SlideContext, 'index'>): string {
  const palette = templatePalette(context.carousel.template, context.kit.colors);
  const pages = context.carousel.slides.map((_, index) =>
    slideMarkup({ ...context, index }, index),
  );
  const pageCss = `@page{size:${SLIDE_SIZE.width}px ${SLIDE_SIZE.height}px;margin:0}.slide{break-after:page}.slide:last-child{break-after:auto}`;
  return documentHtml(context.fontFaceCss, slideCss(palette) + pageCss, pages.join(''));
}

/**
 * Ciò che determina l'aspetto delle slide, in forma stabile: se cambia, i file esportati non
 * corrispondono più al carosello. Server e app ne calcolano lo sha256 per confrontarli.
 */
export function renderInputKey(carousel: Carousel, kit: BrandKit, initials: string): string {
  return JSON.stringify({
    carousel: {
      template: carousel.template,
      kicker: carousel.kicker,
      slides: carousel.slides.map((s) => [s.kind, s.title, s.body, s.code]),
    },
    colors: [
      kit.colors.ink,
      kit.colors.paper,
      kit.colors.accent,
      kit.colors.accentSoft,
      kit.colors.code,
    ],
    handle: kit.handle,
    logo: kit.logo,
    initials: initials.slice(0, 3),
  });
}

function documentHtml(fontFaceCss: string | undefined, css: string, body: string): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src * data:">
<style>${fontFaceCss ?? ''}${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function slideMarkup(context: SlideContext, index: number): string {
  const { carousel, kit } = context;
  const slide = carousel.slides[index]!;
  return `<main class="slide">
<span class="kicker">${escapeHtml(kickerText(carousel))}</span>
<div class="content ${slide.kind}">${slideContent(slide)}</div>
<footer>${brandMark(context)}${handle(kit)}<span class="count">${index + 1} / ${carousel.slides.length}</span></footer>
</main>`;
}

function kickerText(carousel: Carousel): string {
  if (!carousel.kicker) return '';
  return carousel.template === 'codice' ? `$ cat ${carousel.kicker}` : `// ${carousel.kicker}`;
}

function slideContent(slide: Slide): string {
  const title = `<h1 class="title">${escapeHtml(slide.title)}</h1>`;
  const body = slide.body.trim() ? `<p class="body">${escapeHtml(slide.body.trim())}</p>` : '';
  switch (slide.kind) {
    case 'cover':
    case 'text':
      return title + body;
    case 'list': {
      const items = slideListItems(slide.body)
        .map(
          (item, i) =>
            `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(item)}</span></li>`,
        )
        .join('');
      return `${title}<ol class="items">${items}</ol>`;
    }
    case 'code':
      return `${title}${body}<pre class="code">${escapeHtml(slide.code)}</pre>`;
    case 'cta':
      return `${title}${body}<span class="arrow">→</span>`;
  }
}

function brandMark({ kit, initials }: SlideContext): string {
  const inner = kit.logo
    ? `<img src="${escapeHtml(kit.logo)}" alt="">`
    : escapeHtml(initials.slice(0, 3));
  return `<span class="mark">${inner}</span>`;
}

function handle(kit: BrandKit): string {
  return kit.handle ? `<span class="handle">@${escapeHtml(kit.handle)}</span>` : '';
}

function slideCss(p: Palette): string {
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${p.bg}}
.slide{width:${SLIDE_SIZE.width}px;height:${SLIDE_SIZE.height}px;padding:100px 90px 70px;display:flex;flex-direction:column;gap:45px;overflow:hidden;background:${p.bg};color:${p.fg};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.kicker{min-height:38px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:30px;color:${p.muted}}
.content{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:40px}
.title{margin:0;font-size:75px;font-weight:800;line-height:1.1;letter-spacing:-0.02em;overflow-wrap:break-word}
.body{margin:0;font-size:42px;line-height:1.5;color:${p.soft};white-space:pre-line;overflow-wrap:break-word}
.cover .title{font-size:100px;line-height:1.05;letter-spacing:-0.03em}
.cover .body{line-height:1.4;color:${p.accent}}
.code .title{font-size:70px}
.code .body{font-size:40px;line-height:1.45}
.cta .title{font-size:85px;line-height:1.05;letter-spacing:-0.03em}
.cta .body{line-height:1.4}
.items{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:30px}
.items li{display:flex;gap:30px;align-items:baseline;font-size:42px;line-height:1.4;color:${p.soft}}
.num{flex:none;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:35px;color:${p.accent}}
.code pre,.content pre{margin:0;padding:35px;border-radius:20px;background:${p.codeBg};color:${p.codeFg};font-family:'JetBrains Mono',ui-monospace,monospace;font-size:32px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;font-variant-ligatures:none}
.arrow{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:38px;color:${p.accent}}
footer{display:flex;align-items:center;gap:25px}
.mark{width:70px;height:70px;flex:none;border-radius:18px;background:${p.fg};color:${p.bg};display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:28px;font-weight:500}
.mark img{width:100%;height:100%;object-fit:contain}
.handle{font-size:32px;font-weight:600}
.count{margin-left:auto;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:30px;color:${p.muted}}
`;
}
