import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    // I test di integrazione condividono il MySQL di sviluppo e usano letture con lock
    // (FOR UPDATE SKIP LOCKED): eseguiti in parallelo si bloccherebbero righe a vicenda.
    // La suite completa resta sotto i pochi secondi anche in sequenza.
    fileParallelism: false,
  },
});
