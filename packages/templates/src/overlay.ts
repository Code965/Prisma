import {
  slideListItems,
  type BrandKit,
  type CarouselTemplate,
  type Overlay,
  SLIDE_FONTS,
  fontStack,
} from '@prisma-app/shared';
import { templatePalette } from './palette.js';
import { escapeHtml, kitFonts } from './slide.js';

/**
 * Schede di testo sopra il video (fase 6d): stessi colori e font delle slide dei caroselli, su
 * una pagina trasparente grande quanto il video, così FFmpeg le sovrappone senza spostarle.
 * Il titolo sta in alto; codice ed elenchi a metà, sopra i sottotitoli.
 */

export interface OverlayCardContext {
  overlay: Overlay;
  kit: BrandKit;
  /** Template delle schede: «Terminale» per il codice, quello scelto per il resto. */
  template: CarouselTemplate;
  width: number;
  height: number;
  fontFaceCss?: string;
}

/** Posizione e larghezza della scheda in frazioni del video (anche per l'anteprima nell'editor). */
export function overlayPlacement(
  kind: Overlay['kind'],
  width: number,
  height: number,
): { left: number; top: number; width: number } {
  const landscape = width > height;
  if (landscape) {
    // 16:9: a sinistra il titolo, a destra codice ed elenchi (il volto di solito è al centro).
    return kind === 'title'
      ? { left: 0.05, top: 0.08, width: 0.5 }
      : { left: 0.52, top: 0.2, width: 0.43 };
  }
  const square = Math.abs(width - height) < width * 0.1;
  if (kind === 'title') return { left: 0.07, top: square ? 0.07 : 0.1, width: 0.86 };
  return { left: 0.07, top: square ? 0.42 : 0.5, width: 0.86 };
}

/** Il codice usa sempre il template «Terminale»; titoli ed elenchi quello scelto. */
export function overlayTemplate(
  kind: Overlay['kind'],
  template: CarouselTemplate,
): CarouselTemplate {
  return kind === 'code' ? 'codice' : template;
}

export function renderOverlayCardHtml(context: OverlayCardContext): string {
  const { overlay, kit, width, height } = context;
  const palette = templatePalette(overlayTemplate(overlay.kind, context.template), kit.colors);
  const place = overlayPlacement(overlay.kind, width, height);
  // Misure in proporzione al lato corto: la stessa scheda va bene in 9:16, 1:1 e 16:9.
  const unit = Math.min(width, height) / 1080;
  const px = (value: number) => `${Math.round(value * unit)}px`;
  const fonts = kitFonts(kit);
  const mono = fontStack(fonts.code);
  const title = `<h1>${escapeHtml(overlay.title)}</h1>`;
  const content =
    overlay.kind === 'list'
      ? `${title}<ol>${slideListItems(overlay.body)
          .slice(0, 4)
          .map(
            (item, i) =>
              `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(item)}</span></li>`,
          )
          .join('')}</ol>`
      : overlay.kind === 'code'
        ? `${title}<pre>${escapeHtml(overlay.code)}</pre>`
        : title;
  const css = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;width:${width}px;height:${height}px;overflow:hidden}
.card{position:absolute;left:${Math.round(place.left * width)}px;top:${Math.round(place.top * height)}px;width:${Math.round(place.width * width)}px;padding:${px(40)} ${px(46)};border-radius:${px(28)};background:${palette.bg};color:${palette.fg};font-family:${fontStack(fonts.body)};-webkit-font-smoothing:antialiased;box-shadow:0 ${px(18)} ${px(60)} rgba(0,0,0,.35);display:flex;flex-direction:column;gap:${px(24)}}
.card.title{border-left:${px(14)} solid ${palette.accent}}
h1{margin:0;font-family:${fontStack(fonts.heading)};font-size:${px(overlay.kind === 'title' ? 64 : 48)};font-weight:${SLIDE_FONTS[fonts.heading].titleWeight};line-height:1.1;letter-spacing:-0.02em;overflow-wrap:break-word}
ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${px(16)}}
li{display:flex;gap:${px(22)};align-items:baseline;font-size:${px(40)};line-height:1.35;color:${palette.soft}}
.num{flex:none;font-family:${mono};font-size:${px(32)};color:${palette.accent}}
pre{margin:0;padding:${px(28)};border-radius:${px(16)};background:${palette.codeBg};color:${palette.codeFg};font-family:${mono};font-size:${px(32)};line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;font-variant-ligatures:none}
`;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src * data:">
<style>${context.fontFaceCss ?? ''}${css}</style>
</head>
<body>
<div class="card ${overlay.kind}">${content}</div>
</body>
</html>`;
}
