import type { Idea, Tag } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  filterIdeas,
  ideaMeta,
  platformCountLabel,
  tagFilterOptions,
  toggleId,
  togglePlatform,
  visibleIdeas,
} from './ideas';

const dotnet: Tag = { id: 1, brandId: 1, name: '.NET' };
const gis: Tag = { id: 2, brandId: 1, name: 'GIS' };

function idea(overrides: Partial<Idea>): Idea {
  return {
    id: 1,
    brandId: 1,
    text: 'Idea',
    source: 'scritta',
    status: 'nuova',
    tags: [],
    targetPlatforms: [],
    inspiration: null,
    createdAt: '2026-11-21T09:00:00.000Z',
    updatedAt: '2026-11-21T09:00:00.000Z',
    ...overrides,
  };
}

const ideas = [
  idea({ id: 1, tags: [dotnet] }),
  idea({ id: 2, tags: [gis] }),
  idea({ id: 3, tags: [dotnet, gis] }),
  idea({ id: 4, tags: [dotnet], status: 'archiviata' }),
];

describe('lista idee', () => {
  it('nasconde le archiviate', () => {
    expect(visibleIdeas(ideas).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('filtra per tag', () => {
    const visible = visibleIdeas(ideas);
    expect(filterIdeas(visible, 'tutti')).toHaveLength(3);
    expect(filterIdeas(visible, gis.id).map((i) => i.id)).toEqual([2, 3]);
  });

  it('conta le idee per ogni filtro', () => {
    expect(tagFilterOptions(visibleIdeas(ideas), [dotnet, gis])).toEqual([
      { key: 'tutti', label: 'Tutti', count: 3 },
      { key: 1, label: '.NET', count: 2 },
      { key: 2, label: 'GIS', count: 2 },
    ]);
  });

  it('descrive origine e data', () => {
    const now = new Date('2026-11-22T10:00:00Z');
    expect(ideaMeta(idea({ source: 'vocale' }), now)).toBe('dettata a voce · ieri');
  });

  it('scrive il numero di piattaforme al singolare e al plurale', () => {
    expect(platformCountLabel(1)).toBe('1 piattaforma');
    expect(platformCountLabel(3)).toBe('3 piattaforme');
  });

  it('aggiunge e toglie piattaforme mantenendo l’ordine canonico', () => {
    expect(togglePlatform(['youtube'], 'linkedin')).toEqual(['linkedin', 'youtube']);
    expect(togglePlatform(['linkedin', 'youtube'], 'linkedin')).toEqual(['youtube']);
  });

  it('aggiunge e toglie id', () => {
    expect(toggleId([1, 2], 2)).toEqual([1]);
    expect(toggleId([1], 3)).toEqual([1, 3]);
  });
});
