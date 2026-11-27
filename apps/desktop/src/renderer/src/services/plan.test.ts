import type { EditorialPlan, Idea, PlanState } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  canGoForward,
  currentMonth,
  dayGroups,
  frequencyRows,
  monthTitle,
  pendingItemIds,
  pillarRows,
  plannedDayLabel,
  plannedIdeasByDay,
  reviewTiles,
  shiftMonth,
} from './plan';

const NOW = new Date('2026-12-10T10:00:00.000Z');

const plan: EditorialPlan = {
  id: 1,
  month: '2026-12',
  model: 'fake',
  createdAt: '2026-11-27T10:00:00.000Z',
  summary: 'Un mese su Rust.',
  pillars: [
    { name: 'Rust in pratica', description: 'Esempi veri.', tagId: 3 },
    { name: 'Strumenti', description: 'Strumenti provati.', tagId: null },
  ],
  frequencies: [
    {
      platform: 'linkedin',
      perWeek: 2,
      formats: ['post', 'carosello'],
      slots: [{ weekday: 1, hour: 8 }],
      note: 'Due a settimana.',
    },
  ],
  items: [
    {
      id: 'i0',
      day: '2026-12-08',
      hour: 8,
      platform: 'linkedin',
      format: 'carosello',
      pillar: 'Rust in pratica',
      text: 'Il borrow checker',
      source: 'trend',
      reference: { label: 'Rust 2.0', url: 'https://hn.example/1' },
      ideaId: 5,
    },
    {
      id: 'i1',
      day: '2026-12-15',
      hour: null,
      platform: 'linkedin',
      format: 'post',
      pillar: 'Strumenti',
      text: 'Profiling',
      source: 'pilastro',
      reference: null,
      ideaId: null,
    },
  ],
  reviewComment: null,
};

const state: PlanState = {
  month: '2026-12',
  plan,
  review: {
    until: '2026-12-10',
    elapsed: 10 / 31,
    totals: { items: 2, ideas: 1, drafts: 0, scheduled: 0, published: 0, late: 1 },
    items: [
      {
        itemId: 'i0',
        progress: 'idea',
        late: true,
        publicationId: null,
        url: null,
        interactions: null,
      },
      {
        itemId: 'i1',
        progress: 'da_creare',
        late: false,
        publicationId: null,
        url: null,
        interactions: null,
      },
    ],
    platforms: [],
    outsidePlan: 1,
  },
  blocked: null,
  booked: [{ day: '2026-12-15', platform: 'instagram', title: 'Reel già fissato' }],
};

describe('mesi', () => {
  it('mese corrente in Italia, titolo e limiti delle frecce', () => {
    expect(currentMonth(new Date('2026-11-30T23:30:00.000Z'))).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthTitle('2026-12')).toBe('dicembre 2026');
    expect(canGoForward('2027-01', NOW)).toBe(true);
    expect(canGoForward('2027-02', NOW)).toBe(false);
  });
});

describe('idee del piano', () => {
  it('per giorno, con stato, ritardo e uscite già fissate', () => {
    const groups = dayGroups(state, NOW);
    expect(groups.map((g) => [g.label, g.past, g.rows.length, g.booked.length])).toEqual([
      ['mar 8', true, 1, 0],
      ['mar 15', false, 1, 1],
    ]);
    expect(groups[0]!.rows[0]).toMatchObject({
      formatLabel: 'Carosello',
      sourceLabel: 'Trend',
      time: '08:00',
      progressLabel: 'In ritardo',
      pending: false,
    });
    expect(groups[1]!.rows[0]).toMatchObject({
      time: null,
      progressLabel: 'Da creare',
      pending: true,
    });
    expect(pendingItemIds(plan, state.review)).toEqual(['i1']);
    expect(pendingItemIds(plan, null)).toEqual(['i1']);
  });

  it('pilastri con il tag e frequenze leggibili', () => {
    expect(pillarRows(plan, [{ id: 3, brandId: 1, name: 'Rust' }])).toEqual([
      { name: 'Rust in pratica', description: 'Esempi veri.', tagName: 'Rust', ideas: 1 },
      { name: 'Strumenti', description: 'Strumenti provati.', tagName: null, ideas: 1 },
    ]);
    expect(frequencyRows(plan)[0]).toMatchObject({
      perWeek: '2 a settimana',
      formats: 'Post, Carosello',
      slots: 'mar 08:00',
      ideas: 2,
    });
    expect(reviewTiles(state.review!)[0]).toEqual({ label: 'Idee create', value: '1/2' });
  });

  it('idee con il giorno proposto, per il Calendario e le Idee', () => {
    const idea = (
      id: number,
      plannedDay: string | null,
      status: Idea['status'] = 'nuova',
    ): Idea => ({
      id,
      brandId: 1,
      text: `Idea ${id}\nFormato: post`,
      source: 'suggerita',
      status,
      tags: [],
      targetPlatforms: ['linkedin'],
      inspiration: null,
      plannedDay,
      createdAt: '2026-11-27T10:00:00.000Z',
      updatedAt: '2026-11-27T10:00:00.000Z',
    });
    const map = plannedIdeasByDay([
      idea(1, '2026-12-08'),
      idea(2, '2026-12-08', 'in_lavorazione'),
      idea(3, '2026-12-09', 'usata'),
      idea(4, null),
    ]);
    expect([...map].map(([day, list]) => [day, list.map((i) => i.id)])).toEqual([
      ['2026-12-08', [1, 2]],
    ]);
    expect(plannedDayLabel('2026-12-08')).toBe('mar 8 dic');
  });
});
