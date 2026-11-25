import {
  DEFAULT_BRAND_FONTS,
  SLIDE_FONTS,
  fontStack,
  isDefaultFonts,
  resolveTemplate,
  slideListItems,
  type BrandFonts,
  type BrandKit,
  type Carousel,
  type Slide,
  type TemplateStyle,
} from '@prisma-app/shared';
import { hexAlpha } from './colors.js';
import { tonePalette, type Palette } from './palette.js';

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
   * Regole `@font-face` per i font del kit (`kit.fonts`), fornite da chi disegna (renderer o main di
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
  const style = slideStyle(context);
  const palette = tonePalette(style.tone, kit.colors);
  // Una slide sola non scorre mai: niente barre anche se la finestra è più piccola.
  const singleCss = 'html,body{overflow:hidden}';
  return documentHtml(
    context.fontFaceCss,
    slideCss(palette, kitFonts(kit)) + styleCss(style, palette, kit) + singleCss,
    slideMarkup(context, index),
  );
}

/**
 * Tutte le slide in un solo documento, una per pagina 1080×1350: è il PDF dei caroselli di
 * LinkedIn (stampato da Electron con `preferCSSPageSize`).
 */
export function renderCarouselPdfHtml(context: Omit<SlideContext, 'index'>): string {
  const style = slideStyle(context);
  const palette = tonePalette(style.tone, context.kit.colors);
  const pages = context.carousel.slides.map((_, index) =>
    slideMarkup({ ...context, index }, index),
  );
  const pageCss = `@page{size:${SLIDE_SIZE.width}px ${SLIDE_SIZE.height}px;margin:0}.slide{break-after:page}.slide:last-child{break-after:auto}`;
  return documentHtml(
    context.fontFaceCss,
    slideCss(palette, kitFonts(context.kit)) + styleCss(style, palette, context.kit) + pageCss,
    pages.join(''),
  );
}

/**
 * Ciò che determina l'aspetto delle slide, in forma stabile: se cambia, i file esportati non
 * corrispondono più al carosello. Server e app ne calcolano lo sha256 per confrontarli.
 */
export function renderInputKey(carousel: Carousel, kit: BrandKit, initials: string): string {
  const resolved = resolveTemplate(carousel.template, kit.templates);
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
    // Lo stile di un template del kit cambia l'aspetto anche a parità di id.
    ...(resolved.custom ? { style: resolved.style } : {}),
    // Solo se cambiati: gli export fatti prima della scelta dei font restano aggiornati.
    ...(isDefaultFonts(kitFonts(kit)) ? {} : { fonts: kitFonts(kit) }),
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

/** Stile del template del carosello (pronto o del kit). */
function slideStyle(context: Pick<SlideContext, 'carousel' | 'kit'>): TemplateStyle {
  return resolveTemplate(context.carousel.template, context.kit.templates).style;
}

/**
 * Struttura della slide. Con logo e numerazione in basso è quella di sempre (le slide dei tre
 * template della fase 2 restano identiche); gli stili della fase 7b spostano segno e numeri.
 */
function slideMarkup(context: SlideContext, index: number): string {
  const { carousel, kit } = context;
  const style = slideStyle(context);
  const slide = carousel.slides[index]!;
  const kicker = `<span class="kicker">${escapeHtml(kickerText(carousel, style))}</span>`;
  const brand = `${brandMark(context)}${handle(kit)}`;
  const count = `<span class="count">${index + 1} / ${carousel.slides.length}</span>`;
  const percent = Math.round(((index + 1) / carousel.slides.length) * 100);
  const progress = `<span class="progress"><span style="width:${percent}%"></span></span>`;
  const topRight =
    (style.logo === 'top' ? `<span class="brand">${brand}</span>` : '') +
    (style.numbering === 'top' ? count : '');
  const top = topRight ? `<header>${kicker}${topRight}</header>` : kicker;
  const bottom =
    (style.logo === 'bottom' ? brand : '') +
    (style.numbering === 'bottom' ? count : style.numbering === 'progress' ? progress : '');
  const deco = hasDecorationElement(style) ? '<div class="deco"></div>\n' : '';
  return `<main class="slide">
${deco}${top}
<div class="content ${slide.kind}">${slideContent(slide)}</div>
<footer>${bottom}</footer>
</main>`;
}

function kickerText(carousel: Carousel, style: TemplateStyle): string {
  if (!carousel.kicker) return '';
  return style.tone === 'codice' ? `$ cat ${carousel.kicker}` : `// ${carousel.kicker}`;
}

function hasDecorationElement(style: TemplateStyle): boolean {
  return style.decoration !== 'none' && style.decoration !== 'rule';
}

/** Dimensioni dei titoli del template di base, moltiplicate da `titleScale`. */
const TITLE_SIZES = { base: 75, cover: 100, code: 70, cta: 85 } as const;

/** CSS aggiunto dallo stile: vuoto per quello di base (le slide restano identiche a prima). */
function styleCss(style: TemplateStyle, p: Palette, kit: BrandKit): string {
  const rules: string[] = [];
  const bg = style.background;
  if (bg.kind === 'gradient') {
    rules.push(
      `.slide{background:linear-gradient(${bg.angle}deg,${kit.colors[bg.from]},${kit.colors[bg.to]})}`,
    );
  } else if (bg.kind === 'image') {
    const veil = hexAlpha(p.bg, bg.dim);
    rules.push(
      `.slide{background:linear-gradient(${veil},${veil}),url("${bg.image}") center/cover no-repeat ${p.bg}}`,
    );
  }
  if (hasDecorationElement(style)) {
    rules.push(
      '.slide{position:relative}.slide>*{position:relative;z-index:1}.slide>.deco{position:absolute;z-index:0;pointer-events:none}',
      decorationCss(style, p),
    );
  }
  if (style.decoration === 'rule') {
    rules.push(
      `.title::before{content:"";display:block;width:120px;height:8px;margin:0 0 40px;border-radius:4px;background:${p.accent}}`,
    );
  }
  if (style.logo === 'top' || style.numbering === 'top') {
    rules.push(
      'header{display:flex;align-items:center;gap:25px;min-height:70px}header .kicker{flex:1;min-height:0}.brand{display:flex;align-items:center;gap:25px}header .count{margin-left:0}',
    );
  }
  if (style.logo !== 'bottom' && style.numbering !== 'bottom' && style.numbering !== 'progress') {
    rules.push('footer{min-height:70px}');
  }
  if (style.numbering === 'progress') {
    rules.push(
      `.progress{margin-left:auto;width:220px;height:8px;border-radius:4px;background:${hexAlpha(p.fg, 0.18)};overflow:hidden}.progress span{display:block;height:100%;border-radius:4px;background:${p.accent}}`,
    );
  }
  if (style.titleScale !== 1) {
    const size = (px: number) => `${Math.round(px * style.titleScale)}px`;
    rules.push(
      `.title{font-size:${size(TITLE_SIZES.base)}}.cover .title{font-size:${size(TITLE_SIZES.cover)}}.code .title{font-size:${size(TITLE_SIZES.code)}}.cta .title{font-size:${size(TITLE_SIZES.cta)}}`,
    );
  }
  if (style.uppercase) rules.push('.title{text-transform:uppercase;letter-spacing:-0.01em}');
  if (style.align === 'center') {
    rules.push(
      '.content{align-items:center;text-align:center}.title::before{margin-left:auto;margin-right:auto}.items,.content pre{align-self:stretch;text-align:left}',
    );
  }
  return rules.join('\n');
}

function decorationCss(style: TemplateStyle, p: Palette): string {
  switch (style.decoration) {
    case 'blob':
      return `.deco{inset:0;background:radial-gradient(circle at 88% 10%,${hexAlpha(p.accent, 0.42)} 0,transparent 42%),radial-gradient(circle at 6% 96%,${hexAlpha(p.accent, 0.22)} 0,transparent 38%)}`;
    case 'grid':
      return `.deco{inset:0;background-image:linear-gradient(${hexAlpha(p.fg, 0.1)} 2px,transparent 2px),linear-gradient(90deg,${hexAlpha(p.fg, 0.1)} 2px,transparent 2px);background-size:90px 90px;background-position:-1px -1px}`;
    case 'dots':
      return `.deco{inset:0;background-image:radial-gradient(${hexAlpha(p.fg, 0.16)} 3px,transparent 3.5px);background-size:45px 45px}`;
    case 'corner':
      return `.deco{top:-220px;right:-220px;width:620px;height:620px;border-radius:50%;background:${hexAlpha(p.fg, 0.12)};box-shadow:0 0 0 90px ${hexAlpha(p.fg, 0.06)}}`;
    default:
      return '';
  }
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

/** Font del kit (quelli di sempre per i kit senza scelta). */
export function kitFonts(kit: Pick<BrandKit, 'fonts'>): BrandFonts {
  return kit.fonts ?? DEFAULT_BRAND_FONTS;
}

function slideCss(p: Palette, fonts: BrandFonts): string {
  const heading = fontStack(fonts.heading);
  const body = fontStack(fonts.body);
  const mono = fontStack(fonts.code);
  const weight = SLIDE_FONTS[fonts.heading].titleWeight;
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${p.bg}}
.slide{width:${SLIDE_SIZE.width}px;height:${SLIDE_SIZE.height}px;padding:100px 90px 70px;display:flex;flex-direction:column;gap:45px;overflow:hidden;background:${p.bg};color:${p.fg};font-family:${body};-webkit-font-smoothing:antialiased}
.kicker{min-height:38px;font-family:${mono};font-size:30px;color:${p.muted}}
.content{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:40px}
.title{margin:0;font-family:${heading};font-size:75px;font-weight:${weight};line-height:1.1;letter-spacing:-0.02em;overflow-wrap:break-word}
.body{margin:0;font-size:42px;line-height:1.5;color:${p.soft};white-space:pre-line;overflow-wrap:break-word}
.cover .title{font-size:100px;line-height:1.05;letter-spacing:-0.03em}
.cover .body{line-height:1.4;color:${p.accent}}
.code .title{font-size:70px}
.code .body{font-size:40px;line-height:1.45}
.cta .title{font-size:85px;line-height:1.05;letter-spacing:-0.03em}
.cta .body{line-height:1.4}
.items{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:30px}
.items li{display:flex;gap:30px;align-items:baseline;font-size:42px;line-height:1.4;color:${p.soft}}
.num{flex:none;font-family:${mono};font-size:35px;color:${p.accent}}
.code pre,.content pre{margin:0;padding:35px;border-radius:20px;background:${p.codeBg};color:${p.codeFg};font-family:${mono};font-size:32px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;font-variant-ligatures:none}
.arrow{font-family:${mono};font-size:38px;color:${p.accent}}
footer{display:flex;align-items:center;gap:25px}
.mark{width:70px;height:70px;flex:none;border-radius:18px;background:${p.fg};color:${p.bg};display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:${mono};font-size:28px;font-weight:500}
.mark img{width:100%;height:100%;object-fit:contain}
.handle{font-size:32px;font-weight:600}
.count{margin-left:auto;font-family:${mono};font-size:30px;color:${p.muted}}
`;
}
