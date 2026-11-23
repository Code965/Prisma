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
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // Video dei progetti, serviti dal main con il protocollo prisma-media.
  "media-src 'self' prisma-media:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* https:",
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
