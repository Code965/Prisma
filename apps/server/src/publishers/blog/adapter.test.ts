import type { Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { FakeBlog } from '../../../test/helpers/fake-blog.js';
import { PublishError, type PublishRequest } from '../types.js';
import { createBlogAdapter } from './adapter.js';
import { createBlogClient, normalizeBlogBaseUrl } from './client.js';

const words = (n: number) =>
  `<p>${Array.from({ length: n }, (_, i) => `parola${i}`).join(' ')}</p>`;

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 1,
    contentId: 1,
    platform: 'blog',
    format: 'articolo',
    body: `<h2>Intro</h2>${words(400)}`,
    metadata: {
      hashtags: ['#dotnet'],
      title: 'Perché uso ancora VB.NET',
      description: 'Estratto.',
    },
    status: 'in_pubblicazione',
    version: 3,
    approvedAt: null,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const blog = new FakeBlog();
  const adapter = createBlogAdapter(createBlogClient({ fetch: blog.fetch }));
  const request = (v = variant()): PublishRequest => ({
    publicationId: 7,
    idempotencyKey: 'f'.repeat(64),
    variant: v,
    account: { id: 1, externalId: 'https://api.sito.test', accessToken: blog.apiKey },
    media: [],
  });
  return { blog, adapter, request };
}

describe('adapter del blog', () => {
  it('pubblica sull’API del sito con chiave e idempotenza', async () => {
    const { blog, adapter, request } = setup();
    const result = await adapter.publish(request());
    expect(result).toEqual({
      externalId: '1',
      externalUrl: 'https://sito.test/blog/1',
      warnings: [],
    });
    expect(blog.requests[0]).toMatchObject({
      url: 'https://api.sito.test/articles',
      method: 'POST',
      headers: { authorization: `Bearer ${blog.apiKey}` },
      body: {
        title: 'Perché uso ancora VB.NET',
        html: variant().body,
        idempotencyKey: 'f'.repeat(64),
      },
    });
  });

  it('ritentare dopo un timeout non crea un secondo articolo', async () => {
    const { blog, adapter, request } = setup();
    await adapter.publish(request());
    const again = await adapter.publish(request());
    expect(again.externalId).toBe('1');
    expect(again.warnings?.[0]).toMatch(/già presente/);
    expect(blog.articles.size).toBe(1);
  });

  it('classifica gli errori: chiave e dati sbagliati non si ritentano, rete e 5xx sì', async () => {
    const cases: Array<[FakeBlog['failNext'][number], boolean]> = [
      [{ status: 401 }, false],
      [{ status: 503, body: { error: 'non_configurato', message: 'manca la chiave' } }, false],
      [
        { status: 400, body: { error: 'richiesta_non_valida', message: 'HTML non ammesso' } },
        false,
      ],
      [{ status: 500 }, true],
      [{ status: 429 }, true],
      ['network', true],
    ];
    for (const [failure, retryable] of cases) {
      const { blog, adapter, request } = setup();
      blog.failNext.push(failure);
      const error = await adapter.publish(request()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PublishError);
      expect((error as PublishError).retryable).toBe(retryable);
    }
  });

  it('valida titolo, testo ed estratto', () => {
    const { adapter } = setup();
    const levels = (v: Variant) => adapter.validate(v).map((i) => `${i.level}:${i.message}`);
    expect(levels(variant())).toEqual(['ok:Titolo', 'ok:Articolo di 401 parole']);
    expect(levels(variant({ metadata: { hashtags: [] } }))).toContain(
      "error:Manca il titolo dell'articolo",
    );
    expect(levels(variant({ body: words(50) })).join()).toMatch(/warning:Articolo di 50 parole/);
    expect(levels(variant({ body: '<p> </p>' })).join()).toMatch(
      /error:Il testo dell'articolo è vuoto/,
    );
  });
});

describe('indirizzo del sito', () => {
  it('accetta https e http solo in locale, togliendo la barra finale', () => {
    expect(normalizeBlogBaseUrl(' https://api.sito.test/ ')).toBe('https://api.sito.test');
    expect(normalizeBlogBaseUrl('https://sito.test/server/')).toBe('https://sito.test/server');
    expect(normalizeBlogBaseUrl('http://localhost:3001')).toBe('http://localhost:3001');
    expect(normalizeBlogBaseUrl('http://sito.test')).toBeNull();
    expect(normalizeBlogBaseUrl('https://sito.test/?x=1')).toBeNull();
    expect(normalizeBlogBaseUrl('non è un indirizzo')).toBeNull();
  });
});
