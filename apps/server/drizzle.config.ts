import { defineConfig } from 'drizzle-kit';

// Solo per generare le migrazioni (`pnpm db:generate`): il database è un file SQLite e le
// migrazioni le applica il server all'avvio (src/db/migrations.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
