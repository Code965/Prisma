import { defineConfig } from 'drizzle-kit';
import { loadDotEnv } from './src/config/env.js';

loadDotEnv();

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
