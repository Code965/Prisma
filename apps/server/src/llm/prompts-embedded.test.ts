import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from '../db/migrations.generated.js';
import { readPromptFiles } from './generate-prompts.js';
import { createPromptLibrary } from './prompts.js';
import { EMBEDDED_PROMPTS } from './prompts.generated.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('copie nel codice per l’app desktop', () => {
  it('i prompt copiati coincidono con i file (altrimenti: pnpm --filter @prisma-app/server embed)', () => {
    expect(EMBEDDED_PROMPTS).toEqual(readPromptFiles());
  });

  it('le migrazioni copiate coincidono con la cartella drizzle', () => {
    for (const migration of MIGRATIONS) {
      const file = readFileSync(join(root, 'drizzle', `${migration.tag}.sql`), 'utf8');
      expect(migration.sql).toBe(file);
    }
  });

  it('senza cartella dei prompt si usano quelli copiati', () => {
    const prompts = createPromptLibrary(null);
    expect(prompts.render('generate-variants.system', { brandName: 'B', voice: 'V' })).toMatch(
      /json/,
    );
    expect(() => prompts.render('non-esiste')).toThrow(/sconosciuto/);
  });
});
