import type { AnalyticsReport, PlatformSeries, PublicationMetrics } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  compactNumber,
  linkedinDraft,
  manualInput,
  manualSummary,
  platformCard,
  topRows,
} from './analytics';

const report: Pick<AnalyticsReport, 'buckets' | 'period'> = {
  period: '8w',
  buckets: [
    { start: '2026-11-02', end: '2026-11-09', label: '2 nov' },
    { start: '2026-11-09', end: '2026-11-16', label: '9 nov' },
    { start: '2026-11-16', end: '2026-11-23', label: '16 nov' },
  ],
};

const series = (reach: Array<number | null>): PlatformSeries => ({
  platform: 'instagram',
  series: { reach, followers: [null, null, null], interactions: [null, null, null] },
  notes: { reach: null, followers: null, interactions: null },
});

describe('numeri e riquadri', () => {
  it('numeri compatti come nel mockup', () => {
    expect(compactNumber(1240)).toBe('1.240');
    expect(compactNumber(18_200)).toBe('18,2k');
    expect(compactNumber(20_000)).toBe('20k');
    expect(compactNumber(6400, 1000)).toBe('6,4k');
  });

  it('totale, variazione sull’intervallo precedente e barre proporzionate', () => {
    const card = platformCard(series([400, 800, 1000]), 'reach', report);
    expect(card.total).toBe('2.200');
    expect(card.delta).toEqual({ text: '+25% sett.', positive: true });
    expect(card.bars.map((b) => b.height)).toEqual(['40%', '80%', '100%']);
    expect(card.bars[2]).toMatchObject({ current: true, tip: '16 nov: 1.000' });
    expect(card.aria).toBe('Instagram, copertura: 400, 800, 1.000');
  });

  it('senza dati: «—», nessuna variazione e la nota su cosa fare', () => {
    const card = platformCard(series([null, null, null]), 'reach', report);
    expect(card).toMatchObject({ total: '—', delta: null, hasData: false });
    expect(card.note).toMatch(/collega l’account Instagram/);
    expect(platformCard(series([500, null, 300]), 'reach', report).delta).toBeNull();
    const linkedin: PlatformSeries = {
      platform: 'linkedin',
      series: {
        reach: [null, null, null],
        followers: [null, null, null],
        interactions: [null, null, null],
      },
      notes: {
        reach: 'Impressioni inserite a mano',
        followers: 'Non disponibili da LinkedIn',
        interactions: null,
      },
    };
    expect(platformCard(linkedin, 'followers', report).note).toBe('Non disponibili da LinkedIn');
    expect(platformCard(linkedin, 'reach', report).note).toMatch(/inserisci le metriche/);
  });

  it('righe dei contenuti migliori', () => {
    const rows = topRows([
      {
        publicationId: 1,
        contentId: 1,
        title: 'Clean Code',
        platform: 'tiktok',
        format: 'video',
        publishedAt: '2026-11-19T19:00:00.000Z',
        externalUrl: null,
        reach: 18_200,
        reachKind: 'visualizzazioni',
        interactions: 1240,
      },
    ]);
    expect(rows[0]).toMatchObject({
      n: 1,
      format: 'Video · TikTok',
      reach: '18,2k',
      reachTitle: 'Valore: visualizzazioni',
      interactions: '1.240',
    });
  });
});

describe('metriche LinkedIn a mano', () => {
  const metrics = {
    impressions: 4700,
    likes: 120,
    comments: null,
    shares: 6,
  } as PublicationMetrics;

  it('dal modulo alla richiesta: vuoti ignorati, punti delle migliaia tollerati, testo rifiutato', () => {
    expect(
      manualInput({ impressions: '4.700', likes: '120', comments: '', shares: ' 6 ' }),
    ).toEqual({
      impressions: 4700,
      likes: 120,
      shares: 6,
    });
    expect(manualInput({ impressions: '', likes: '', comments: '', shares: '' })).toBeNull();
    expect(manualInput({ impressions: 'tanti', likes: '', comments: '', shares: '' })).toBeNull();
    expect(linkedinDraft(metrics)).toEqual({
      impressions: '4700',
      likes: '120',
      comments: '',
      shares: '6',
    });
    expect(manualSummary(metrics)).toBe('4.700 impressioni · 120 reazioni · 6 diffusioni');
    expect(manualSummary(null)).toBe('Metriche non ancora inserite');
  });
});
