import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { UserConfig } from 'vite';

/**
 * Configurazione del renderer condivisa tra Electron (electron.vite.config.ts) e l'anteprima
 * nel browser (vite.web.config.ts), usata per confrontare le schermate con il mockup.
 */
export const rendererConfig: UserConfig = {
  root: resolve(import.meta.dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: { '@renderer': resolve(import.meta.dirname, 'src/renderer/src') },
  },
};
