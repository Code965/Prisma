import { defineConfig } from 'tsup';

/**
 * Server da solo (Docker o un PC/VPS sempre acceso): un unico file `dist/index.js` con tutte le
 * dipendenze, così l'immagine non ha bisogno di node_modules. Migrazioni e prompt sono già nel
 * codice; il database SQLite usa `node:sqlite` di Node 24.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/.*/],
  // `node:sqlite` esiste solo con il prefisso: tsup non deve toglierlo.
  removeNodeProtocol: false,
  external: ['node:sqlite'],
  // Alcune dipendenze CommonJS usano require: nel bundle ESM serve un require vero.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
