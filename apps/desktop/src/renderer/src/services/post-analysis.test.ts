import type { PlatformPostAnalysis, PostAnalysis } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  aiSubtitle,
  conclusionRows,
  dimensionBlocks,
  platformSubtitle,
  postRows,
} from './post-analysis';

const platform = (over: Partial<PlatformPostAnalysis> = {}): PlatformPostAnalysis => ({
  platform: 'linkedin',
  published: 3,
  measured: 2,
  basis: 'visualizzazioni',
  medianRate: 0.032,
  medianInteractions: 12,
  dimensions: [
    {
      dimension: 'argomento',
      groups: [
        {
          key: 'Rust',
          label: 'Rust',
          posts: 2,
          medianRate: 0.04,
          medianInteractions: 10,
          fewData: false,
          publicationIds: [1, 2],
        },
        {
          key: '',
          label: 'Senza argomento',
          posts: 1,
          medianRate: 0.01,
          medianInteractions: 3,
          fewData: true,
          publicationIds: [3],
        },
      ],
    },
    { dimension: 'formato', groups: [] },
  ],
  posts: [
    {
      publicationId: 1,
      title: 'Perché Rust',
      url: 'https://www.linkedin.com/feed/update/1',
      publishedAt: '2026-11-20T08:00:00.000Z',
      format: 'post',
      tags: ['Rust'],
      words: 120,
      opening: 'Perché Rust?',
      openingKind: 'Domanda',
      interactions: 20,
      rate: 0.04,
    },
    {
      publicationId: 3,
      title: 'Senza metriche',
      url: null,
      publishedAt: '2026-11-21T08:00:00.000Z',
      format: 'carosello',
      tags: [],
      words: 40,
      opening: 'Ciao.',
      openingKind: 'Affermazione',
      interactions: null,
      rate: null,
    },
  ],
  ...over,
});

describe('cosa funziona nei tuoi post', () => {
  it('sottotitolo con la base del tasso o cosa manca', () => {
    expect(platformSubtitle(platform())).toBe(
      '2 post misurati su 3 · tasso mediano 3,2% sulle visualizzazioni',
    );
    expect(platformSubtitle(platform({ basis: null, medianRate: null }))).toMatch(
      /interazioni mediane 12 \(senza visualizzazioni/,
    );
    expect(platformSubtitle(platform({ measured: 0 }))).toMatch(/ancora nessuna metrica/);
  });

  it('gruppi con barra relativa al migliore, pochi dati, dimensioni vuote tolte', () => {
    const blocks = dimensionBlocks(platform());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.rows.map((r) => [r.label, r.value, r.count, r.width])).toEqual([
      ['Rust', '4%', '2 post', 100],
      ['Senza argomento', '1%', '1 post · pochi dati', 25],
    ]);
    const noBasis = dimensionBlocks(platform({ basis: null }));
    expect(noBasis[0]!.rows[0]!.value).toBe('10 interaz.');
  });

  it('post con data italiana, formato, apertura e valore', () => {
    const rows = postRows(platform(), [1, 3]);
    expect(rows[0]).toMatchObject({
      meta: '20 nov · Post · 120 parole · Domanda',
      value: '4% · 20 interaz.',
    });
    expect(rows[1]!.value).toBe('nessuna metrica');
    expect(postRows(platform(), [3])).toHaveLength(1);
  });

  it('conclusioni dell’AI con i post citati', () => {
    const analysis: PostAnalysis = {
      generatedAt: '2026-11-27T12:00:00.000Z',
      windowDays: 90,
      platforms: [platform()],
      aiBlocked: null,
      ai: {
        model: 'fake',
        createdAt: '2026-11-27T12:00:00.000Z',
        basedOn: 2,
        conclusions: [{ text: 'Le domande funzionano.', publicationIds: [1, 99] }],
      },
    };
    expect(conclusionRows(analysis)).toEqual([
      {
        text: 'Le domande funzionano.',
        posts: [
          {
            id: 1,
            title: 'Perché Rust',
            url: 'https://www.linkedin.com/feed/update/1',
            platform: 'LinkedIn',
          },
        ],
      },
    ]);
    expect(aiSubtitle(analysis)).toBe("fake · su 2 post · aperture classificate dall'AI");
    expect(conclusionRows(undefined)).toEqual([]);
  });
});
