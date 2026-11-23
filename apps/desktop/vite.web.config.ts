import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { rendererConfig } from './renderer.config.js';

/**
 * Solo il renderer, nel browser: utile per lo sviluppo della UI e il confronto con il mockup.
 * Le chiamate a `/api/*` passano da un proxy che aggiunge il token lato Node (letto dal .env
 * alla radice): come in Electron, il token non arriva mai al codice dell'interfaccia.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, '../..'), '');
  // Non si usa PORT: `loadEnv` legge anche le variabili del processo, e chi avvia Vite può
  // impostare PORT con la porta di Vite stesso (il proxy finirebbe per chiamare se stesso).
  const target = env.PRISMA_SERVER_URL || 'http://127.0.0.1:4000';

  return {
    ...rendererConfig,
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          headers: env.API_TOKEN ? { Authorization: `Bearer ${env.API_TOKEN}` } : {},
        },
      },
    },
  };
});
