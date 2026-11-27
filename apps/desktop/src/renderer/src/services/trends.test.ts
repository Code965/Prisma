import type { TrendReport, TrendsState } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  addKeyword,
  compactNumber,
  cooldownMinutes,
  keywordSuggestions,
  signalLabels,
  sourceNotes,
  trendCards,
} from './trends';

const report: TrendReport = {
  id: 1,
  createdAt: '2026-11-27T07:12:00.000Z',
  model: 'deepseek:deepseek-flash',
  keywords: ['rust'],
  sources: [
    { source: 'hackernews', items: 1, requests: 1, error: null },
    { source: 'youtube', items: 0, requests: 0, error: 'Collega un account YouTube' },
  ],
  items: [
    {
      id: 'hackernews:1',
      source: 'hackernews',
      title: 'Rust 2.0',
      url: 'https://a',
      author: null,
      description: null,
      publishedAt: '2026-11-26T00:00:00.000Z',
      keyword: 'rust',
      signals: { points: 412, comments: 1 },
    },
  ],
  trends: [
    {
      title: 'Rust',
      summary: 's',
      why: 'w',
      idea: 'i',
      scores: { growth: 4, interest: 3, fit: 5 },
      tagId: 9,
      itemIds: ['hackernews:1', 'sparito'],
    },
  ],
};

describe('radar dei trend', () => {
  it('segnali veri abbreviati, solo quelli presenti', () => {
    expect(compactNumber(1234)).toBe('1234');
    expect(compactNumber(12_345)).toBe('12,3k');
    expect(compactNumber(2_500_000)).toBe('2,5 Mln');
    expect(signalLabels({ points: 412, comments: 1 })).toEqual(['412 punti', '1 commento']);
  });

  it('schede con contenuti risolti e argomento ancora esistente', () => {
    const [card] = trendCards(report, [{ id: 9, brandId: 1, name: 'Rust' }]);
    expect(card).toMatchObject({ tagName: 'Rust', tagId: 9, sources: ['hackernews'] });
    expect(card!.items).toHaveLength(1);
    expect(card!.items[0]!.signalText).toBe('412 punti · 1 commento');
    expect(trendCards(report, [])[0]).toMatchObject({ tagId: null, tagName: null });
    expect(sourceNotes(report)).toEqual(['YouTube: Collega un account YouTube']);
  });

  it('parole: niente doppioni, al massimo 5, suggerimenti dagli argomenti', () => {
    expect(addKeyword(['rust'], 'Rust')).toEqual({ error: 'Parola già presente' });
    expect(addKeyword(['a1', 'b1', 'c1', 'd1', 'e1'], 'go')).toEqual({
      error: 'Al massimo 5 parole',
    });
    expect(addKeyword([], 'x')).toHaveProperty('error');
    expect(addKeyword(['rust'], ' node.js ')).toEqual({ keywords: ['rust', 'node.js'] });
    const tags = [
      { id: 1, brandId: 1, name: 'Rust' },
      { id: 2, brandId: 1, name: 'AI' },
    ];
    expect(keywordSuggestions(['rust'], tags)).toEqual(['AI']);
  });

  it('attesa prima del prossimo «Aggiorna»', () => {
    const state = { nextRefreshAt: '2026-11-27T08:00:00.000Z' } as TrendsState;
    expect(cooldownMinutes(state, new Date('2026-11-27T07:50:30.000Z'))).toBe(10);
    expect(cooldownMinutes(state, new Date('2026-11-27T08:01:00.000Z'))).toBeNull();
  });
});
