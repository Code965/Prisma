import { DEFAULT_BRAND, type Brand, type Tag } from '@prisma-app/shared';

/** Passi della configurazione guidata del primo avvio. */
export const SETUP_STEPS = [
  { id: 'benvenuto', title: 'Benvenuto' },
  { id: 'brand', title: 'Il tuo brand' },
  { id: 'ai', title: 'AI' },
  { id: 'account', title: 'Account' },
  { id: 'fine', title: 'Pronto' },
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

/**
 * La configurazione guidata si apre su un database appena creato: un solo brand con il nome
 * predefinito e configurazione non ancora completata (o saltata). Chi ha già dati non la vede.
 */
export function shouldShowSetup(brands: readonly Brand[] | undefined, completed: boolean): boolean {
  return !completed && brands?.length === 1 && brands[0]!.name === DEFAULT_BRAND.name;
}

/** Iniziali dal nome: le prime lettere di due parole («Marta Rossi» → MR), o due di una sola. */
export function initialsFrom(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return '';
  const letters =
    words.length === 1
      ? [...words[0]!].filter((char) => /\p{L}|\p{N}/u.test(char)).slice(0, 2)
      : words.slice(0, 2).map((word) => [...word].find((char) => /\p{L}|\p{N}/u.test(char)) ?? '');
  return letters.join('').toUpperCase();
}

/** Argomento scritto dall'utente: spazi superflui tolti, al massimo 40 caratteri. */
export function normalizeTag(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 40);
}

/** Cosa creare e cosa togliere per passare dagli argomenti salvati a quelli scelti. */
export function tagChanges(existing: readonly Tag[], desired: readonly string[]) {
  const wanted = new Set(desired.map((name) => name.toLocaleLowerCase('it')));
  const have = new Set(existing.map((tag) => tag.name.toLocaleLowerCase('it')));
  return {
    add: desired.filter((name) => !have.has(name.toLocaleLowerCase('it'))),
    remove: existing.filter((tag) => !wanted.has(tag.name.toLocaleLowerCase('it'))),
  };
}
