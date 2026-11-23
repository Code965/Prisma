import type { InsightsState } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { insightCards, insightsSubtitle } from './insights';

const state: InsightsState = {
  blocked: null,
  insights: {
    id: 1,
    createdAt: '2026-11-23T06:00:00.000Z',
    weekStart: '2026-11-23',
    model: 'deepseek:deepseek-flash',
    basedOn: 12,
    tips: [
      {
        kind: 'argomenti',
        text: 'Il legacy funziona.',
        why: 'Su 12 contenuti',
        idea: 'Migrare VB.NET a .NET 8',
      },
      { kind: 'orari', text: 'LinkedIn alle 8.', why: 'Slot dai dati', idea: null },
      { kind: 'formati', text: 'Video brevi.', why: 'Su 5 video', idea: null },
    ],
  },
};

describe('suggerimenti dell’AI', () => {
  it('etichette del mockup e azioni: idea dagli argomenti, calendario e video', () => {
    const cards = insightCards(state);
    expect(cards.map((c) => [c.label, c.action])).toEqual([
      [
        'ARGOMENTI CHE FUNZIONANO',
        { kind: 'idea', label: 'Crea un’idea su questo', idea: 'Migrare VB.NET a .NET 8' },
      ],
      ['ORARI MIGLIORI', { kind: 'link', label: 'Apri il calendario', to: '/calendario' }],
      ['FORMATI DA REPLICARE', { kind: 'link', label: 'Apri editor video', to: '/video' }],
    ]);
    expect(insightCards(undefined)).toEqual([]);
  });

  it('sottotitolo con il modello e il giorno in ora italiana', () => {
    expect(insightsSubtitle(state)).toBe('DeepSeek · aggiornati lunedì 23 nov');
    expect(insightsSubtitle({ insights: null, blocked: 'pochi dati' })).toBe(
      'Ogni lunedì, dalle metriche',
    );
  });
});
