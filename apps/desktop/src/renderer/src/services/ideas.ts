import { PLATFORMS, type Idea, type IdeaSource, type Platform, type Tag } from '@prisma-app/shared';
import { relativeDay } from './dates';

export type TagFilter = 'tutti' | number;

export interface TagFilterOption {
  key: TagFilter;
  label: string;
  count: number;
}

/** Le idee archiviate escono dalla lista; restano consultabili dal server. */
export function visibleIdeas(ideas: readonly Idea[]): Idea[] {
  return ideas.filter((idea) => idea.status !== 'archiviata');
}

export function filterIdeas(ideas: readonly Idea[], filter: TagFilter): Idea[] {
  if (filter === 'tutti') return [...ideas];
  return ideas.filter((idea) => idea.tags.some((tag) => tag.id === filter));
}

/** "Tutti" più un filtro per ogni tag del brand, con il numero di idee (come nel mockup). */
export function tagFilterOptions(ideas: readonly Idea[], tags: readonly Tag[]): TagFilterOption[] {
  return [
    { key: 'tutti', label: 'Tutti', count: ideas.length },
    ...tags.map((tag) => ({
      key: tag.id,
      label: tag.name,
      count: ideas.filter((idea) => idea.tags.some((t) => t.id === tag.id)).length,
    })),
  ];
}

const SOURCE_LABELS: Record<IdeaSource, string> = {
  scritta: 'scritta',
  vocale: 'dettata a voce',
  suggerita: 'suggerita dalle analytics',
};

/** Riga sotto il titolo dell'idea: "dettata a voce · ieri". */
export function ideaMeta(idea: Idea, now: Date): string {
  return `${SOURCE_LABELS[idea.source]} · ${relativeDay(idea.createdAt, now)}`;
}

export function platformCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'piattaforma' : 'piattaforme'}`;
}

/** Aggiunge o toglie una piattaforma mantenendo l'ordine canonico (LinkedIn, Instagram…). */
export function togglePlatform(selected: readonly Platform[], platform: Platform): Platform[] {
  const next = new Set(selected);
  if (next.has(platform)) next.delete(platform);
  else next.add(platform);
  return PLATFORMS.filter((p) => next.has(p));
}

export function toggleId(selected: readonly number[], id: number): number[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** Testo della conferma prima di eliminare un'idea. */
export function deleteIdeaConfirm(idea: Idea): string {
  const text = idea.text.length > 80 ? `${idea.text.slice(0, 79)}…` : idea.text;
  const linked = idea.status === 'nuova' ? '' : ' I contenuti già generati restano nello Studio.';
  return `Eliminare l'idea «${text}»?${linked}`;
}
