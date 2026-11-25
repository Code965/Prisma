import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { rendererConfig } from './renderer.config.js';

/**
 * Content Security Policy del renderer, inserita come <meta> nell'HTML della build:
 * i file caricati da disco (file://) non hanno header HTTP. In sviluppo non si applica
 * perché Vite inietta script inline (React refresh).
 */
const CSP = [
  "default-src 'self'",
  // WebAssembly di MediaPipe per l'inquadratura che segue il volto (6e): niente eval di JavaScript.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Immagini del B-roll (6d) dal protocollo prisma-media.
  "img-src 'self' data: https: prisma-media:",
  "font-src 'self' data:",
  // Video dei progetti, serviti dal main con il protocollo prisma-media.
  "media-src 'self' prisma-media:",
  // prisma-app: solo i file dell'app (MediaPipe); prisma-media resta fuori: i video non si leggono.
  "connect-src 'self' http://localhost:* http://127.0.0.1:* https: prisma-app:",
].join('; ');

const cspMeta: Plugin = {
  name: 'prisma-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
};

export default defineConfig({
  main: {
    // I pacchetti del monorepo esportano sorgenti TS: vanno inclusi nel bundle, non lasciati esterni.
    // I font delle slide si importano con `?asset`: esterni, il file non verrebbe copiato.
    build: {
      externalizeDeps: {
        exclude: [
          '@prisma-app/shared',
          '@prisma-app/templates',
          '@fontsource/inter',
          '@fontsource/jetbrains-mono',
        ],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ['@prisma-app/shared'] },
      // Con `sandbox: true` il preload deve essere CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: { ...rendererConfig, plugins: [...(rendererConfig.plugins ?? []), cspMeta] },
});
