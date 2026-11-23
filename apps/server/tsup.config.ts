import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // I pacchetti del monorepo esportano sorgenti TS: vanno inclusi nel bundle.
  noExternal: ['@prisma-app/shared', '@prisma-app/templates'],
});
