import type { Content, Idea, VariantStatus } from '@prisma-app/shared';

/**
 * Elenco dei contenuti nello «Studio contenuto» ed eliminazione di un'idea con i suoi contenuti
 * mai usciti. Un contenuto ha una variant per piattaforma: compare in ogni filtro in cui ricade
 * almeno una delle sue variant.
 */

export const CONTENT_FILTERS = [
  'tutti',
  'da_fare',
  'approvati',
  'in_coda',
  'pubblicati',
  'errori',
] as const;
export type ContentFilter = (typeof CONTENT_FILTERS)[number];

export const CONTENT_FILTER_LABELS: Record<ContentFilter, string> = {
  tutti: 'Tutti',
  da_fare: 'Bozze',
  approvati: 'Approvati',
  in_coda: 'In coda',
  pubblicati: 'Pubblicati',
  errori: 'Errori',
};

const FILTER_STATUSES: Record<Exclude<ContentFilter, 'tutti'>, readonly VariantStatus[]> = {
  da_fare: ['bozza', 'da_approvare'],
  approvati: ['approvato'],
  in_coda: ['programmato', 'in_pubblicazione'],
  pubblicati: ['pubblicato'],
  errori: ['errore'],
};

export function matchesFilter(content: Content, filter: ContentFilter): boolean {
  if (filter === 'tutti') return true;
  return content.variants.some((v) => FILTER_STATUSES[filter].includes(v.status));
}

/** Contenuti del filtro, i più recenti per primi. */
export function filterContents(contents: readonly Content[], filter: ContentFilter): Content[] {
  return contents
    .filter((c) => matchesFilter(c, filter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function filterCounts(contents: readonly Content[]): Record<ContentFilter, number> {
  return Object.fromEntries(
    CONTENT_FILTERS.map((f) => [f, contents.filter((c) => matchesFilter(c, f)).length]),
  ) as Record<ContentFilter, number>;
}

/** Mai uscito: nessuna variant oltre «approvato» (il server ricontrolla le pubblicazioni). */
export function neverPublished(content: Content): boolean {
  return content.variants.every((v) => ['bozza', 'da_approvare', 'approvato'].includes(v.status));
}

export function ideaContents(
  contents: readonly Content[],
  ideaId: number,
): { total: number; removable: number } {
  const linked = contents.filter((c) => c.ideaId === ideaId);
  return { total: linked.length, removable: linked.filter(neverPublished).length };
}

const short = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Le domande prima di eliminare un'idea: la prima per l'idea, la seconda (se ci sono contenuti
 * mai usciti) per eliminare anche quelli; i pubblicati e quelli in coda restano comunque.
 */
export function deleteIdeaQuestions(
  idea: Idea,
  summary: { total: number; removable: number },
): { idea: string; drafts: string | null } {
  const kept = summary.total - summary.removable;
  const first =
    summary.total === 0
      ? `Eliminare l'idea «${short(idea.text)}»?`
      : `Eliminare l'idea «${short(idea.text)}»? ${summary.total === 1 ? 'Ne è nato 1 contenuto' : `Ne sono nati ${summary.total} contenuti`}.`;
  if (summary.removable === 0) {
    const stays = summary.total === 1 ? 'Resta nello Studio.' : 'Restano nello Studio.';
    return { idea: summary.total > 0 ? `${first} ${stays}` : first, drafts: null };
  }
  const keptNote =
    kept > 0
      ? ` ${plural(kept, 'contenuto già in coda o pubblicato resta', 'contenuti già in coda o pubblicati restano')} comunque.`
      : '';
  return {
    idea: first,
    drafts: `Eliminare anche ${plural(summary.removable, 'contenuto mai uscito', 'contenuti mai usciti')} (bozze e approvati)? Con «Annulla» restano nello Studio.${keptNote}`,
  };
}
