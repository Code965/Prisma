import { DEFAULT_RECOMMENDED_SLOTS, type PublicationMetrics } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { weekSummary, type AccountDayRow, type PostRow } from './aggregate.js';
import { MIN_POSTS, romeSlot, slotsFromPosts } from './slots.js';

const metrics = (reach: number): PublicationMetrics => ({
  publicationId: 1,
  capturedAt: '2026-11-22T10:00:00.000Z',
  impressions: null,
  reach,
  views: null,
  likes: 10,
  comments: null,
  shares: null,
  saves: null,
  source: 'api',
});

let id = 0;
/** Post Instagram pubblicato a un'ora italiana (novembre: UTC+1). */
const post = (isoRome: string, reach: number): PostRow => ({
  publicationId: ++id,
  contentId: id,
  title: `Post ${id}`,
  platform: 'instagram',
  format: 'carosello',
  publishedAt: new Date(`${isoRome}+01:00`),
  externalUrl: null,
  metrics: metrics(reach),
});

describe('slot consigliati dai dati', () => {
  it('giorno e ora in Italia', () => {
    expect(romeSlot(new Date('2026-11-16T07:00:00Z'))).toEqual({ weekday: 0, hour: 8 });
    expect(romeSlot(new Date('2026-11-22T23:30:00Z'))).toEqual({ weekday: 0, hour: 0 });
  });

  it('con pochi post restano quelli predefiniti', () => {
    const few = Array.from({ length: MIN_POSTS - 1 }, (_, i) =>
      post(`2026-11-1${i}T13:00:00`, 1000),
    );
    expect(slotsFromPosts('instagram', few)).toEqual({
      platform: 'instagram',
      slots: DEFAULT_RECOMMENDED_SLOTS.instagram,
      source: 'predefinito',
      basedOn: 7,
    });
  });

  it('l’ora e i 3 giorni con il punteggio medio più alto (almeno 2 post ciascuno)', () => {
    const posts = [
      // Martedì e giovedì alle 18 vanno molto meglio della mediana.
      post('2026-11-03T18:00:00', 5000),
      post('2026-11-10T18:00:00', 4800),
      post('2026-11-05T18:00:00', 4200),
      post('2026-11-12T18:00:00', 4000),
      // Lunedì alle 9 nella media, sabato alle 9 sotto.
      post('2026-11-02T09:00:00', 1000),
      post('2026-11-09T09:00:00', 1100),
      post('2026-11-07T09:00:00', 400),
      post('2026-11-14T09:00:00', 500),
      // Un solo post la domenica, anche se ottimo, non basta per il giorno.
      post('2026-11-08T18:00:00', 9000),
    ];
    expect(slotsFromPosts('instagram', posts)).toEqual({
      platform: 'instagram',
      slots: [
        { weekday: 0, hour: 18 },
        { weekday: 1, hour: 18 },
        { weekday: 3, hour: 18 },
      ],
      source: 'dati',
      basedOn: 9,
    });
  });
});

describe('riepilogo della settimana', () => {
  it('follower all’ultimo giorno, variazione e copertura dei 7 giorni', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    const day = (d: string, patch: Partial<AccountDayRow>): AccountDayRow => ({
      platform: 'youtube',
      day: d,
      followers: null,
      followersGained: null,
      followersLost: null,
      reach: null,
      views: null,
      ...patch,
    });
    const summary = weekSummary(
      [
        day('2026-11-14', { views: 999, followersGained: 50 }),
        day('2026-11-18', { views: 1200, followersGained: 10, followersLost: 2 }),
        day('2026-11-21', { views: 1900, followersGained: 8 }),
        day('2026-11-22', { followers: 412 }),
      ],
      [],
      now,
    );
    expect(summary.find((s) => s.platform === 'youtube')).toEqual({
      platform: 'youtube',
      followers: 412,
      followersDelta: 16,
      reach: 3100,
      reachLabel: 'visualizzazioni',
    });
    expect(summary.find((s) => s.platform === 'linkedin')).toMatchObject({
      followers: null,
      reach: null,
      reachLabel: 'impressioni',
    });
  });
});
