import type { Competitor, CompetitorsState, ProfileStats } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  comparisonGroups,
  emptyPostForm,
  percent,
  postInput,
  rateText,
  slotLabel,
  statsLines,
} from './competitors';

const stats = (over: Partial<ProfileStats> = {}): ProfileStats => ({
  posts: 6,
  weeks: 4,
  postsPerWeek: 1.5,
  basis: 'visualizzazioni',
  medianRate: 0.032,
  medianInteractions: 120,
  followers: 12_300,
  formats: [{ format: 'short', posts: 4, medianRate: 0.05, medianInteractions: 200 }],
  slots: [{ weekday: 4, hour: 9, posts: 2, score: 0.04 }],
  top: [],
  ...over,
});

const competitor = (id: number, over: Partial<Competitor> = {}): Competitor => ({
  id,
  brandId: 1,
  name: `C${id}`,
  platform: 'youtube',
  handle: '@c',
  url: null,
  notes: null,
  externalId: null,
  followers: null,
  lastFetchedAt: null,
  lastError: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  posts: [],
  stats: stats(),
  ...over,
});

describe('concorrenti', () => {
  it('percentuali, fasce e righe delle statistiche', () => {
    expect(percent(0.032)).toBe('3,2%');
    expect(percent(0.0045)).toBe('0,45%');
    expect(percent(null)).toBe('—');
    expect(slotLabel({ weekday: 4, hour: 9 })).toBe('ven 09:00');
    expect(statsLines(stats(), 'youtube')).toEqual([
      '1,5 post a settimana (6 in 4 sett.)',
      'tasso mediano 3,2% sulle visualizzazioni',
      '12,3k iscritti',
    ]);
    expect(rateText(stats({ medianRate: null, basis: null }))).toMatch(/non calcolabile/);
    expect(rateText(stats({ posts: 0, medianRate: null }))).toMatch(/nessun post/);
  });

  it('confronto per piattaforma con «Tu» e basi diverse segnalate', () => {
    const state: CompetitorsState = {
      competitors: [
        competitor(1),
        competitor(2, { platform: 'linkedin', stats: stats({ posts: 0 }) }),
      ],
      own: [{ platform: 'youtube', stats: stats({ basis: 'follower', medianRate: 0.01 }) }],
      analysis: null,
      analysisBlocked: null,
    };
    const groups = comparisonGroups(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ platform: 'youtube', mixedBases: true });
    expect(groups[0]!.rows.map((r) => [r.name, r.bestFormat, r.bestSlot])).toEqual([
      ['Tu', 'short', 'ven 09:00'],
      ['C1', 'short', 'ven 09:00'],
    ]);
  });

  it('modulo del post: ora italiana, numeri vuoti non noti, errori in italiano', () => {
    const form = {
      ...emptyPostForm('linkedin', '2026-11-20'),
      text: 'Tre errori',
      url: 'https://www.linkedin.com/posts/x',
      likes: '1.200',
      comments: '',
    };
    const result = postInput(form);
    expect(result).toEqual({
      input: expect.objectContaining({
        publishedAt: '2026-11-20T08:00:00.000Z',
        format: 'post',
        likes: 1200,
        comments: null,
      }),
    });
    expect(postInput({ ...form, url: 'nope' })).toEqual({
      error: 'Incolla il link del post (http o https)',
    });
    expect(postInput({ ...form, likes: '1,5' })).toEqual({
      error: 'I numeri devono essere interi, senza decimali',
    });
    expect(postInput({ ...form, text: '' })).toEqual({
      error: 'Scrivi il titolo o il testo del post',
    });
  });
});
