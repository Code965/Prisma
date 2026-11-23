import type { PublicationMetrics } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  periodBuckets,
  platformSeries,
  postReach,
  romeDay,
  topContents,
  type AccountDayRow,
  type PostRow,
} from './aggregate.js';

// Domenica 22 novembre 2026, 12:00 UTC.
const now = new Date('2026-11-22T12:00:00.000Z');

const metrics = (patch: Partial<PublicationMetrics>): PublicationMetrics => ({
  publicationId: 1,
  capturedAt: '2026-11-22T10:00:00.000Z',
  impressions: null,
  reach: null,
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  source: 'api',
  ...patch,
});

const post = (
  id: number,
  platform: PostRow['platform'],
  publishedAt: string,
  m: Partial<PublicationMetrics> | null,
): PostRow => ({
  publicationId: id,
  contentId: id,
  title: `Post ${id}`,
  platform,
  format: 'video',
  publishedAt: new Date(publishedAt),
  externalUrl: null,
  metrics: m ? metrics(m) : null,
});

const day = (
  platform: AccountDayRow['platform'],
  d: string,
  patch: Partial<AccountDayRow>,
): AccountDayRow => ({
  platform,
  day: d,
  followers: null,
  followersGained: null,
  followersLost: null,
  reach: null,
  views: null,
  ...patch,
});

describe('periodi', () => {
  it('8 settimane da lunedì, l’ultima contiene oggi; 30 giorni a giorni', () => {
    const weeks = periodBuckets('8w', now);
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)).toEqual({ start: '2026-11-16', end: '2026-11-23', label: '16 nov' });
    expect(weeks[0]).toMatchObject({ start: '2026-09-28', label: '28 set' });
    expect(periodBuckets('90d', now)).toHaveLength(13);
    const days = periodBuckets('30d', now);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ start: '2026-11-22', end: '2026-11-23', label: '22 nov' });
  });

  it('giorni in ora italiana: le 23:30 UTC di sabato sono già domenica', () => {
    expect(romeDay(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11-22');
  });
});

describe('serie per piattaforma', () => {
  const buckets = periodBuckets('8w', now).slice(-2); // 9-15 nov e 16-22 nov

  it('Instagram: copertura dell’account, follower dalla differenza dei totali, interazioni dei post', () => {
    const days = [
      day('instagram', '2026-11-08', { followers: 2000 }),
      day('instagram', '2026-11-10', { reach: 500 }),
      day('instagram', '2026-11-15', { followers: 2030, reach: 300 }),
      day('instagram', '2026-11-20', { reach: 900 }),
      day('instagram', '2026-11-22', { followers: 2100 }),
    ];
    const posts = [
      post(1, 'instagram', '2026-11-18T10:00:00Z', {
        reach: 4000,
        likes: 300,
        comments: 20,
        saves: 40,
      }),
    ];
    const result = platformSeries('instagram', days, posts, buckets);
    expect(result.series).toEqual({
      reach: [800, 900],
      followers: [30, 70],
      interactions: [null, 360],
    });
    expect(result.notes.reach).toBeNull();
  });

  it('YouTube: visualizzazioni del canale e iscritti guadagnati meno persi', () => {
    const days = [
      day('youtube', '2026-11-12', { views: 300, followersGained: 6, followersLost: 1 }),
      day('youtube', '2026-11-17', { views: 450, followersGained: 9, followersLost: 0 }),
      day('youtube', '2026-11-22', { followers: 1250 }),
    ];
    const result = platformSeries('youtube', days, [], buckets);
    expect(result.series.reach).toEqual([300, 450]);
    expect(result.series.followers).toEqual([5, 9]);
    expect(result.notes.reach).toBe('Visualizzazioni del canale');
  });

  it('TikTok e LinkedIn: misure dei post del periodo, con la nota', () => {
    const posts = [
      post(2, 'tiktok', '2026-11-19T19:00:00Z', { views: 18200, likes: 1100 }),
      post(3, 'linkedin', '2026-11-11T07:00:00Z', {
        impressions: 4700,
        likes: 120,
        source: 'manuale',
      }),
    ];
    expect(platformSeries('tiktok', [], posts, buckets).series.reach).toEqual([null, 18200]);
    const linkedin = platformSeries('linkedin', [], posts, buckets);
    expect(linkedin.series.reach).toEqual([4700, null]);
    expect(linkedin.notes).toMatchObject({
      reach: 'Impressioni inserite a mano',
      followers: 'Non disponibili da LinkedIn',
    });
  });
});

describe('contenuti migliori', () => {
  it('ordinati per copertura (o misura equivalente), poi per interazioni; senza metriche esclusi', () => {
    const top = topContents([
      post(1, 'instagram', '2026-11-18T10:00:00Z', { reach: 6400, likes: 400 }),
      post(2, 'tiktok', '2026-11-19T19:00:00Z', { views: 18200, likes: 1100, comments: 90 }),
      post(3, 'linkedin', '2026-11-11T07:00:00Z', { impressions: 4700 }),
      post(4, 'youtube', '2026-11-12T07:00:00Z', null),
    ]);
    expect(top.map((t) => [t.publicationId, t.reach, t.reachKind, t.interactions])).toEqual([
      [2, 18200, 'visualizzazioni', 1190],
      [1, 6400, 'copertura', 400],
      [3, 4700, 'impressioni', null],
    ]);
    expect(postReach(null)).toEqual({ value: null, kind: null });
  });
});
