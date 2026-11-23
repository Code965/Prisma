import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dopo `drizzle-kit generate` copia le migrazioni SQL in `migrations.generated.ts`: così il
 * server le ha nel codice anche quando gira dentro l'app desktop (bundle senza la cartella).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const folder = join(root, 'drizzle');
const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};
const migrations = journal.entries
  .sort((a, b) => a.idx - b.idx)
  .map(({ tag }) => ({ tag, sql: readFileSync(join(folder, `${tag}.sql`), 'utf8') }));

const out = `// File generato da src/db/generate-migrations.ts (pnpm db:generate): non modificarlo a mano.
export const MIGRATIONS: readonly { tag: string; sql: string }[] = ${JSON.stringify(migrations, null, 2)};
`;
writeFileSync(join(root, 'src/db/migrations.generated.ts'), out);
console.log(`Migrazioni nel codice: ${migrations.map((m) => m.tag).join(', ')}`);
