import type { Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { FakeLinkedIn } from '../../../test/helpers/fake-linkedin.js';
import { PublishError, type PublishRequest } from '../types.js';
import { createLinkedInAdapter } from './adapter.js';
import { createLinkedInClient } from './client.js';

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 1,
    contentId: 1,
    platform: 'linkedin',
    format: 'post',
    body: 'Ho costruito un client database (in .NET).',
    metadata: { hashtags: ['#dotnet'], firstComment: 'Repo: https://example.test' },
    status: 'in_pubblicazione',
    version: 4,
    approvedAt: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

function request(v = variant()): PublishRequest {
  return {
    publicationId: 9,
    idempotencyKey: 'k'.repeat(64),
    variant: v,
    account: { id: 1, externalId: 'abc123', accessToken: 'access-123' },
    media: [],
  };
}

function setup(linkedin = FakeLinkedIn.happyPath()) {
  const client = createLinkedInClient({ apiVersion: '202611', fetch: linkedin.fetch });
  return { linkedin, adapter: createLinkedInAdapter(client) };
}

async function publishError(linkedin: FakeLinkedIn): Promise<PublishError> {
  const { adapter } = setup(linkedin);
  const error = await adapter.publish(request()).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PublishError);
  return error as PublishError;
}

describe('adapter LinkedIn', () => {
  it('pubblica il post con gli header della Posts API e poi il primo commento', async () => {
    const { linkedin, adapter } = setup();
    const result = await adapter.publish(request());

    expect(result).toEqual({
      externalId: 'urn:li:share:7000',
      externalUrl: 'https://www.linkedin.com/feed/update/urn:li:share:7000/',
      warnings: [],
    });

    const [post, comment] = linkedin.requests;
    expect(post).toMatchObject({ url: 'https://api.linkedin.com/rest/posts', method: 'POST' });
    expect(post!.headers).toMatchObject({
      authorization: 'Bearer access-123',
      'linkedin-version': '202611',
      'x-restli-protocol-version': '2.0.0',
    });
    expect(JSON.parse(post!.body)).toEqual({
      author: 'urn:li:person:abc123',
      commentary: 'Ho costruito un client database \\(in .NET\\).\n\n{hashtag|\\#|dotnet}',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });

    expect(comment!.url).toBe(
      'https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7000/comments',
    );
    expect(JSON.parse(comment!.body)).toEqual({
      actor: 'urn:li:person:abc123',
      object: 'urn:li:share:7000',
      message: { text: 'Repo: https://example.test' },
    });
  });

  it('non fallisce se manca solo il primo commento', async () => {
    const linkedin = FakeLinkedIn.happyPath().on(
      'https://api.linkedin.com/rest/socialActions/',
      () => new Response('{"message":"Not enough permissions"}', { status: 403 }),
    );
    const result = await setup(linkedin).adapter.publish(request());
    expect(result.externalId).toBe('urn:li:share:7000');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/primo commento/);
  });

  it('senza primo commento fa una sola chiamata', async () => {
    const { linkedin, adapter } = setup();
    await adapter.publish(request(variant({ metadata: { hashtags: [] } })));
    expect(linkedin.requests).toHaveLength(1);
  });

  it('classifica gli errori per non pubblicare mai due volte', async () => {
    const status = (code: number) =>
      FakeLinkedIn.happyPath().on(
        'https://api.linkedin.com/rest/posts',
        () => new Response('errore', { status: code }),
      );

    expect(await publishError(status(401))).toMatchObject({ retryable: false });
    expect((await publishError(status(401))).message).toMatch(/ricollega/);
    expect(await publishError(status(429))).toMatchObject({ retryable: true });
    expect(await publishError(status(422))).toMatchObject({ retryable: false });
    // Un 5xx potrebbe essere arrivato dopo la creazione del post: niente ritentativo automatico.
    const serverError = await publishError(status(503));
    expect(serverError).toMatchObject({ retryable: false });
    expect(serverError.message).toMatch(/Esito incerto/);
  });

  it('ritenta solo gli errori di rete in cui la richiesta non è partita', async () => {
    const networkError = (code: string) =>
      new FakeLinkedIn().on('https://api.linkedin.com/rest/posts', () => {
        throw new TypeError('fetch failed', { cause: { code } });
      });
    expect(await publishError(networkError('ECONNREFUSED'))).toMatchObject({ retryable: true });
    expect(await publishError(networkError('ECONNRESET'))).toMatchObject({ retryable: false });
  });

  it('non ritenta se il post è stato creato ma manca l’id', async () => {
    const linkedin = FakeLinkedIn.happyPath().on(
      'https://api.linkedin.com/rest/posts',
      () => new Response(null, { status: 201 }),
    );
    expect(await publishError(linkedin)).toMatchObject({ retryable: false });
  });

  it('valida formato, testo vuoto, lunghezza e link', () => {
    const { adapter } = setup();
    const errors = (v: Variant) =>
      adapter
        .validate(v)
        .filter((i) => i.level === 'error')
        .map((i) => i.message);

    expect(errors(variant())).toEqual([]);
    expect(errors(variant({ format: 'video' }))[0]).toMatch(/non ancora supportato/);
    expect(errors(variant({ body: '   ' }))[0]).toMatch(/vuoto/);
    expect(errors(variant({ body: 'x'.repeat(3000) }))[0]).toMatch(/3000/);

    const warnings = adapter
      .validate(variant({ body: 'Leggi https://example.test' }))
      .filter((i) => i.level === 'warning');
    expect(warnings[0]!.message).toMatch(/primo commento/);
  });
});
