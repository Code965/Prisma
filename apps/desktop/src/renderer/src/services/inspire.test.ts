import type { CompetitorPost, Inspiration, TrendItem } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  competitorTarget,
  initialPlatforms,
  inspiredIdeaInput,
  inspireRequest,
  pastedTarget,
  signalLines,
  trendTarget,
} from './inspire';

const post: CompetitorPost = {
  id: 7,
  competitorId: 1,
  externalId: null,
  title: null,
  text: 'Tre errori   che faccio\ncon TypeScript',
  url: 'https://www.linkedin.com/posts/marta-1',
  publishedAt: '2026-11-25T09:00:00.000+00:00',
  format: 'carosello',
  durationSec: null,
  likes: 120,
  comments: 30,
  shares: null,
  views: null,
  followers: 5000,
  source: 'manuale',
};

const proposal: Inspiration = {
  inspiration: {
    kind: 'concorrente',
    competitorPostId: 7,
    label: 'Marta',
    platform: 'linkedin',
    title: 'Tre errori',
    url: post.url,
  },
  signals: null,
  mechanism: { hook: 'Confessione', structure: ['Errori', 'Domanda'], whyItWorked: 'Chiaro.' },
  idea: { topic: 'Docker', tagId: 3, text: 'Gli sbagli con Docker.', hook: 'Per mesi…' },
  model: 'fake',
};

describe('inspire', () => {
  it('prepara il post del concorrente e la richiesta con l’argomento scelto', () => {
    const target = competitorTarget(post, { name: 'Marta', platform: 'linkedin' });
    expect(target).toMatchObject({
      source: { kind: 'concorrente', postId: 7 },
      title: 'Tre errori che faccio con TypeScript',
      label: 'Marta',
    });
    expect(inspireRequest(target, { kind: 'ai' })).toEqual({ source: target.source });
    expect(inspireRequest(target, { kind: 'tag', tagId: 3 })).toMatchObject({ tagId: 3 });
    expect(inspireRequest(target, { kind: 'testo', text: ' Rust ' })).toMatchObject({
      topic: 'Rust',
    });
    expect(initialPlatforms(target)).toEqual(['linkedin']);
  });

  it('usa i contenuti del radar e i testi incollati', () => {
    const item: TrendItem = {
      id: 'hackernews:1',
      source: 'hackernews',
      title: 'Show HN: deploy',
      url: 'https://news.ycombinator.com/item?id=1',
      author: 'pg',
      description: null,
      publishedAt: '2026-11-25T09:00:00.000+00:00',
      keyword: 'deploy',
      signals: { points: 300 },
    };
    expect(trendTarget(item).source).toEqual({
      kind: 'testo',
      title: 'Show HN: deploy',
      text: 'Show HN: deploy',
      url: item.url,
      platform: null,
      label: 'Hacker News · pg',
    });
    expect(pastedTarget('  ', '')).toEqual({ error: expect.stringMatching(/Incolla/) });
    expect(pastedTarget('Testo', 'ftp://x')).toEqual({ error: expect.stringMatching(/http/) });
    expect(pastedTarget('Testo', '')).toMatchObject({ source: { url: null }, platform: null });
  });

  it('mostra solo i numeri salvati', () => {
    expect(signalLines(null)).toEqual([]);
    expect(
      signalLines({
        views: null,
        likes: 1200,
        comments: 30,
        shares: null,
        basis: 'follower',
        rate: 0.031,
        medianRate: 0.02,
      }),
    ).toEqual([
      '1200 like',
      '30 commenti',
      expect.stringMatching(
        /^interazioni 3,1\s?% sui follower \(mediana del profilo 2(,0)?\s?%\)$/,
      ),
    ]);
  });

  it('salva l’idea con il riferimento, il tag e le piattaforme', () => {
    expect(inspiredIdeaInput(proposal, ' Testo mio ', ['linkedin', 'blog'])).toEqual({
      text: 'Testo mio',
      source: 'suggerita',
      tagIds: [3],
      targetPlatforms: ['linkedin', 'blog'],
      inspiration: proposal.inspiration,
    });
    expect(inspiredIdeaInput(proposal, '', []).text).toContain('Struttura da seguire');
  });
});
