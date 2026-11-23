import type { PublicationMetrics } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import type { PostRow } from './aggregate.js';
import {
  GeneratedInsightsSchema,
  formatPosts,
  formatSeries,
  formatSlots,
  weekStartOf,
} from './insights.js';

const tip = (kind: string, idea: string | null = null) => ({
  kind,
  text: `Testo ${kind}`,
  why: 'Su 4 post',
  idea,
});

describe('risposta del modello', () => {
  it('un suggerimento per tipo, in ordine, con l’idea solo per gli argomenti', () => {
    const parsed = GeneratedInsightsSchema.parse({
      tips: [tip('formati', 'ignorata'), tip('argomenti', ' Migrare a .NET 8 '), tip('orari')],
    });
    expect(parsed.tips.map((t) => [t.kind, t.idea])).toEqual([
      ['argomenti', 'Migrare a .NET 8'],
      ['orari', null],
      ['formati', null],
    ]);
  });

  it('rifiuta tipi ripetuti o mancanti', () => {
    expect(
      GeneratedInsightsSchema.safeParse({
        tips: [tip('argomenti'), tip('argomenti'), tip('orari')],
      }).success,
    ).toBe(false);
    expect(
      GeneratedInsightsSchema.safeParse({ tips: [tip('argomenti'), tip('orari')] }).success,
    ).toBe(false);
  });
});

describe('dati per il prompt', () => {
  it('lunedì della settimana in ora italiana', () => {
    expect(weekStartOf(new Date('2026-11-22T12:00:00Z'))).toBe('2026-11-16');
    expect(weekStartOf(new Date('2026-11-22T23:30:00Z'))).toBe('2026-11-23');
  });

  it('serie con la nota sulla misura, senza quelle vuote', () => {
    const text = formatSeries({
      buckets: [
        { start: '2026-11-09', end: '2026-11-16', label: '9 nov' },
        { start: '2026-11-16', end: '2026-11-23', label: '16 nov' },
      ],
      platforms: [
        {
          platform: 'youtube',
          series: { reach: [300, 450.4], followers: [null, null], interactions: [null, 12] },
          notes: { reach: 'Visualizzazioni del canale', followers: null, interactions: null },
        },
      ],
    });
    expect(text).toBe(
      'Settimane: 9 nov, 16 nov\n- YouTube, copertura (Visualizzazioni del canale): 300, 450\n- YouTube, interazioni: —, 12',
    );
  });

  it('contenuti dal migliore, con giorno, ora e misure presenti', () => {
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
    const post = (id: number, title: string, m: Partial<PublicationMetrics> | null): PostRow => ({
      publicationId: id,
      contentId: id,
      title,
      platform: 'tiktok',
      format: 'video',
      publishedAt: new Date('2026-11-19T19:00:00Z'),
      externalUrl: null,
      metrics: m ? metrics(m) : null,
    });
    expect(
      formatPosts([
        post(1, 'Indici composti', { views: 900, likes: 40 }),
        post(2, 'Clean Code', { views: 18200, likes: 1100, comments: 90 }),
        post(3, 'Senza metriche', null),
      ]),
    ).toBe(
      [
        '- TikTok · video · gio 20:00 · "Clean Code" · visualizzazioni 18200, like 1100, commenti 90',
        '- TikTok · video · gio 20:00 · "Indici composti" · visualizzazioni 900, like 40',
      ].join('\n'),
    );
    expect(
      formatSlots([
        { platform: 'instagram', slots: [{ weekday: 1, hour: 18 }], source: 'dati', basedOn: 12 },
      ]),
    ).toBe('- Instagram: mar 18:00 · dai dati (12 post)');
  });
});
