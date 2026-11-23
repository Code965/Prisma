import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** I prompt stanno in apps/server/prompts, sia eseguendo da src/llm sia dal bundle in dist. */
function defaultPromptsDir(): string {
  const candidates = [resolve(here, '../../prompts'), resolve(here, '../prompts')];
  const found = candidates.find((dir) => existsSync(resolve(dir, 'generate-variants.system.md')));
  if (!found)
    throw new Error(`Cartella dei prompt non trovata (cercata in: ${candidates.join(', ')})`);
  return found;
}

export type PromptVariables = Record<string, string>;

/** Sostituisce i segnaposto `{{nome}}`; un segnaposto senza valore è un errore, non un vuoto. */
export function renderTemplate(template: string, variables: PromptVariables): string {
  const rendered = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) throw new Error(`Variabile di prompt mancante: ${key}`);
    return value;
  });
  return rendered.trim();
}

export interface PromptLibrary {
  render(name: string, variables?: PromptVariables): string;
}

export function createPromptLibrary(dir: string = defaultPromptsDir()): PromptLibrary {
  const cache = new Map<string, string>();
  const read = (name: string): string => {
    let template = cache.get(name);
    if (template === undefined) {
      template = readFileSync(resolve(dir, `${name}.md`), 'utf8');
      cache.set(name, template);
    }
    return template;
  };
  return {
    render: (name, variables = {}) => renderTemplate(read(name), variables),
  };
}
