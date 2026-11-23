import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_PROMPTS } from './prompts.generated.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * I prompt stanno in apps/server/prompts: eseguendo da src/llm o dal bundle in dist si leggono i
 * file (una modifica vale subito). Dentro l'app desktop la cartella non c'è e si usano quelli
 * copiati nel codice (`prompts.generated.ts`).
 */
function defaultPromptsDir(): string | null {
  const candidates = [resolve(here, '../../prompts'), resolve(here, '../prompts')];
  return candidates.find((dir) => existsSync(resolve(dir, 'generate-variants.system.md'))) ?? null;
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

export function createPromptLibrary(dir: string | null = defaultPromptsDir()): PromptLibrary {
  const cache = new Map<string, string>();
  const read = (name: string): string => {
    let template = cache.get(name);
    if (template === undefined) {
      if (dir) {
        template = readFileSync(resolve(dir, `${name}.md`), 'utf8');
      } else {
        template = EMBEDDED_PROMPTS[name];
        if (template === undefined) throw new Error(`Prompt sconosciuto: ${name}`);
      }
      cache.set(name, template);
    }
    return template;
  };
  return {
    render: (name, variables = {}) => renderTemplate(read(name), variables),
  };
}
