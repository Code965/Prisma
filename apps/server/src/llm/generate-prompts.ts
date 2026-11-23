import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copia i prompt di `apps/server/prompts` in `prompts.generated.ts`: il server dentro l'app
 * desktop è un bundle senza la cartella. Si rigenera con `pnpm --filter @prisma-app/server embed`
 * (lo fa anche la build del desktop); un test controlla che sia allineato ai file.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const folder = join(root, 'prompts');

export function readPromptFiles(): Record<string, string> {
  const prompts: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) {
        const name = relative(folder, path).split(sep).join('/').replace(/\.md$/, '');
        prompts[name] = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
      }
    }
  };
  walk(folder);
  return Object.fromEntries(Object.entries(prompts).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prompts = readPromptFiles();
  writeFileSync(
    join(root, 'src/llm/prompts.generated.ts'),
    `// File generato da src/llm/generate-prompts.ts: non modificarlo a mano, modifica prompts/*.md.\nexport const EMBEDDED_PROMPTS: Readonly<Record<string, string>> = ${JSON.stringify(prompts, null, 2)};\n`,
  );
  console.log(`Prompt nel codice: ${Object.keys(prompts).length}`);
}
