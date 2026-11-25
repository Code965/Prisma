import type { Content, Idea, Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  deleteIdeaQuestions,
  filterContents,
  filterCounts,
  ideaContents,
  neverPublished,
} from './content-list';

const content = (
  id: number,
  statuses: Variant['status'][],
  ideaId: number | null = 1,
  updatedAt = '2026-11-20T10:00:00.000Z',
) =>
  ({
    id,
    ideaId,
    title: `C${id}`,
    updatedAt,
    variants: statuses.map((status, i) => ({ id: id * 10 + i, status, platform: 'linkedin' })),
  }) as unknown as Content;

describe('elenco dei contenuti', () => {
  const all = [
    content(1, ['bozza', 'approvato']),
    content(2, ['pubblicato'], 1, '2026-11-24T10:00:00.000Z'),
    content(3, ['programmato', 'errore'], null),
  ];

  it('filtri e conteggi per stato delle variant', () => {
    expect(filterCounts(all)).toEqual({
      tutti: 3,
      da_fare: 1,
      approvati: 1,
      in_coda: 1,
      pubblicati: 1,
      errori: 1,
    });
    expect(filterContents(all, 'tutti').map((c) => c.id)).toEqual([2, 1, 3]);
    expect(filterContents(all, 'approvati').map((c) => c.id)).toEqual([1]);
  });

  it('mai uscito solo se nessuna variant è oltre «approvato»', () => {
    expect(neverPublished(all[0]!)).toBe(true);
    expect(neverPublished(all[1]!)).toBe(false);
    expect(ideaContents(all, 1)).toEqual({ total: 2, removable: 1 });
  });

  it('domande prima di eliminare un’idea', () => {
    const idea = { id: 1, text: 'Rust nei miei progetti' } as Idea;
    expect(deleteIdeaQuestions(idea, { total: 0, removable: 0 })).toEqual({
      idea: "Eliminare l'idea «Rust nei miei progetti»?",
      drafts: null,
    });
    const both = deleteIdeaQuestions(idea, { total: 3, removable: 2 });
    expect(both.idea).toContain('Ne sono nati 3 contenuti.');
    expect(both.drafts).toBe(
      'Eliminare anche 2 contenuti mai usciti (bozze e approvati)? Con «Annulla» restano nello Studio. 1 contenuto già in coda o pubblicato resta comunque.',
    );
    expect(deleteIdeaQuestions(idea, { total: 1, removable: 0 })).toEqual({
      idea: "Eliminare l'idea «Rust nei miei progetti»? Ne è nato 1 contenuto. Resta nello Studio.",
      drafts: null,
    });
  });
});
