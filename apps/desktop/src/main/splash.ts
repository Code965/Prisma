/**
 * Intro all'avvio: finestra senza cornice con il simbolo di Prisma, il nome e la promessa
 * dell'app, mentre la finestra principale si carica. È un documento statico (data URL) con
 * una CSP che vieta script e risorse esterne: niente preload, niente IPC.
 */

/** Simbolo a colori (`design/brand/svg/prisma-simbolo.svg`), con le quattro facce animabili. */
const SYMBOL_SVG = `<svg class="symbol" viewBox="0 0 64 64" aria-hidden="true"><defs><mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><g fill="none" stroke="#000" stroke-width="2.6" stroke-linejoin="round"><path d="M6 32H58M32 6V58"/><path d="M32 21L43 32L32 43L21 32Z"/></g></mask></defs><g mask="url(#gap)"><path class="face f1" fill="#3D7FF2" d="M6 32L32 6V32Z"/><path class="face f2" fill="#E2447F" d="M32 6L58 32H32Z"/><path class="face f3" fill="#17AFA6" d="M58 32L32 58V32Z"/><path class="face f4" fill="#F26B3A" d="M32 58L6 32H32Z"/></g><path class="core" fill="#FFFFFF" d="M32 22.6L41.4 32L32 41.4L22.6 32Z"/></svg>`;

export const SPLASH_SIZE = { width: 520, height: 320 } as const;
/** Quanto resta visibile l'intro come minimo, anche se l'app è già pronta. */
export const SPLASH_MIN_MS = 1800;
export const SPLASH_BACKGROUND = '#101318';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function splashHtml({ version, fontFaceCss }: { version: string; fontFaceCss: string }) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Prisma</title>
<style>
${fontFaceCss}
*{box-sizing:border-box;margin:0}
html,body{height:100%;background:${SPLASH_BACKGROUND};color:#F2F4F7;overflow:hidden;
  font-family:Inter,'Segoe UI',system-ui,sans-serif;-webkit-user-select:none;user-select:none;cursor:default}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;
  background:radial-gradient(120% 90% at 50% 0%,#1A1F28 0%,${SPLASH_BACKGROUND} 62%)}
.mark{display:flex;align-items:center;gap:18px}
.symbol{width:64px;height:64px;overflow:visible}
.face{transform-box:fill-box;transform-origin:center;opacity:0;animation:join .7s cubic-bezier(.2,.8,.2,1) forwards}
.f1{--dx:-10px;--dy:-10px;animation-delay:.05s}.f2{--dx:10px;--dy:-10px;animation-delay:.15s}
.f3{--dx:10px;--dy:10px;animation-delay:.25s}.f4{--dx:-10px;--dy:10px;animation-delay:.35s}
.core{transform-box:fill-box;transform-origin:center;opacity:0;animation:core .5s ease-out .7s forwards}
@keyframes join{from{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.8)}to{opacity:1;transform:none}}
@keyframes core{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
.name{font-size:46px;font-weight:700;letter-spacing:-.04em;opacity:0;animation:rise .6s ease-out .45s forwards}
.tagline{margin-top:14px;font-size:15px;color:#9AA1AC;opacity:0;animation:rise .6s ease-out .75s forwards}
.foot{position:absolute;left:0;right:0;bottom:22px;display:flex;flex-direction:column;align-items:center;gap:12px}
.label{font-family:'JetBrains Mono',Consolas,monospace;font-size:10.5px;letter-spacing:.18em;color:#5B6473;text-transform:uppercase}
.bar{width:132px;height:3px;border-radius:3px;background:#1E242E;overflow:hidden;position:relative}
.bar::after{content:'';position:absolute;inset:0;width:40%;border-radius:3px;
  background:linear-gradient(90deg,#3D7FF2,#E2447F,#17AFA6,#F26B3A);animation:load 1.3s ease-in-out infinite}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes load{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.face,.core,.name,.tagline{animation:none;opacity:1}.bar::after{animation:none;width:100%}}
</style></head>
<body>
<div class="mark">${SYMBOL_SVG}<span class="name">Prisma</span></div>
<p class="tagline">Un’idea, quattro piattaforme.</p>
<div class="foot"><div class="bar" role="progressbar" aria-label="Avvio"></div>
<span class="label">Social studio · v${escapeHtml(version)}</span></div>
</body></html>`;
}

export function splashDataUrl(input: { version: string; fontFaceCss: string }): string {
  return `data:text/html;base64,${Buffer.from(splashHtml(input), 'utf8').toString('base64')}`;
}
