import type { Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { FakeInstagram } from '../../../test/helpers/fake-instagram.js';
import { PublishError, type PublishMedia, type PublishRequest } from '../types.js';
import { buildCaption, createInstagramAdapter, type InstagramAdapterOptions } from './adapter.js';
import { cleanAuthorizationCode, createInstagramClient } from './client.js';

const slide = (title: string) => ({ kind: 'text' as const, title, body: '', code: '' });

function variant(slides = 2, patch: Partial<Variant> = {}): Variant {
  return {
    id: 1,
    contentId: 1,
    platform: 'instagram',
    format: 'carosello',
    body: 'Una settimana bloccato. La soluzione era una riga.',
    metadata: {
      hashtags: ['#dotnet', '#debug'],
      carousel: {
        template: 'scuro',
        kicker: '',
        slides: Array.from({ length: slides }, (_, i) => slide(`Slide ${i + 1}`)),
      },
    },
    status: 'in_pubblicazione',
    version: 6,
    approvedAt: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    ...patch,
  };
}

function image(position: number, patch: Partial<PublishMedia> = {}): PublishMedia {
  return {
    assetId: position + 1,
    kind: 'image',
    role: 'media',
    position,
    mime: 'image/jpeg',
    sizeBytes: 250_000,
    width: 1080,
    height: 1350,
    durationMs: null,
    checksumSha256: String(position).repeat(64),
    localPath: null,
    remoteKey: `brand-1/${position}.jpg`,
    remoteUrl: `https://media.test/brand-1/${position}.jpg`,
    upToDate: true,
    ...patch,
  };
}

function request(v = variant(), media = [image(1), image(0)]): PublishRequest {
  return {
    publicationId: 3,
    idempotencyKey: 'k'.repeat(64),
    variant: v,
    account: { id: 1, externalId: '1789', accessToken: 'lungo-1' },
    media,
  };
}

function setup(instagram = FakeInstagram.happyPath(), options: InstagramAdapterOptions = {}) {
  const client = createInstagramClient({ apiVersion: 'v27.0', fetch: instagram.fetch });
  return {
    instagram,
    adapter: createInstagramAdapter(client, { sleep: async () => {}, ...options }),
  };
}

const errorsOf = (v: Variant, media: PublishMedia[]) =>
  setup()
    .adapter.validate(v, media)
    .filter((i) => i.level === 'error')
    .map((i) => i.message);

describe('Instagram: controlli', () => {
  it('chiede immagini JPEG aggiornate, caricate e con indirizzo pubblico', () => {
    expect(errorsOf(variant(), [image(0), image(1)])).toEqual([]);
    expect(errorsOf(variant(2, { metadata: { hashtags: [] } }), [])[0]).toMatch(/crea le slide/);
    expect(errorsOf(variant(), [])[0]).toMatch(/esporta il carosello in JPG/);
    expect(errorsOf(variant(), [image(0)])[0]).toMatch(/esporta di nuovo/);
    expect(errorsOf(variant(), [image(0), image(1, { upToDate: false })])[0]).toMatch(
      /esporta di nuovo/,
    );
    expect(errorsOf(variant(), [image(0), image(1, { remoteKey: null })])[0]).toMatch(
      /caricate su R2/,
    );
    expect(errorsOf(variant(), [image(0), image(1, { remoteUrl: null })])[0]).toMatch(
      /R2_PUBLIC_BASE_URL/,
    );
    expect(errorsOf(variant(2, { format: 'reel' }), [])[0]).toMatch(/non ancora supportato/);
  });

  it('controlla lunghezza della didascalia e numero di hashtag', () => {
    const long = variant(2, { body: 'x'.repeat(2200) });
    expect(errorsOf(long, [image(0), image(1)])[0]).toMatch(/2200/);
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`);
    const many = variant(2, { metadata: { ...variant().metadata, hashtags: tags } });
    expect(errorsOf(many, [image(0), image(1)])[0]).toMatch(/31 hashtag/);
    expect(buildCaption(' Testo ', ['#a', '#b'])).toBe('Testo\n\n#a #b');
  });

  it('toglie il #_ finale dal codice di autorizzazione', () => {
    expect(cleanAuthorizationCode('abc#_')).toBe('abc');
    expect(cleanAuthorizationCode('abc')).toBe('abc');
  });
});

describe('Instagram: pubblicazione', () => {
  it('carosello: elementi in ordine, container del carosello con didascalia, poi media_publish', async () => {
    const { adapter, instagram } = setup();
    const result = await adapter.publish(request());
    expect(result).toMatchObject({
      externalId: 'm-100',
      externalUrl: 'https://www.instagram.com/p/ABC/',
    });

    const posts = instagram.requests.filter((r) => r.method === 'POST');
    const [first, second, carousel, publish] = posts;
    expect(first!.params.get('image_url')).toBe('https://media.test/brand-1/0.jpg');
    expect(first!.params.get('is_carousel_item')).toBe('true');
    expect(first!.params.get('caption')).toBeNull();
    expect(second!.params.get('image_url')).toBe('https://media.test/brand-1/1.jpg');
    expect(carousel!.params.get('media_type')).toBe('CAROUSEL');
    expect(carousel!.params.get('children')).toBe('c1,c2');
    expect(carousel!.params.get('caption')).toBe(
      'Una settimana bloccato. La soluzione era una riga.\n\n#dotnet #debug',
    );
    expect(publish!.url.pathname).toBe('/v27.0/1789/media_publish');
    expect(publish!.params.get('creation_id')).toBe('c3');
    expect(posts.every((r) => r.params.get('access_token') === 'lungo-1')).toBe(true);
  });

  it('una slide sola diventa un post con un’immagine', async () => {
    const { adapter, instagram } = setup();
    await adapter.publish(request(variant(1), [image(0)]));
    const posts = instagram.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.params.get('is_carousel_item')).toBeNull();
    expect(posts[0]!.params.get('caption')).toMatch(/^Una settimana/);
  });

  it('prima di media_publish ritenta i problemi temporanei, dopo no', async () => {
    const errorOf = async (instagram: FakeInstagram, options: InstagramAdapterOptions = {}) =>
      (await setup(instagram, options)
        .adapter.publish(request())
        .catch((e: unknown) => e)) as PublishError;

    const quota = FakeInstagram.happyPath().on(
      'GET https://graph.instagram.com/v27.0/1789/content_publishing_limit',
      () => Response.json({ data: [{ quota_usage: 50, config: { quota_total: 50 } }] }),
    );
    expect(await errorOf(quota)).toMatchObject({ retryable: true });

    const busy = FakeInstagram.happyPath().on(
      'POST https://graph.instagram.com/v27.0/1789/media',
      () => new Response('{"error":{"message":"Service unavailable"}}', { status: 503 }),
    );
    expect(await errorOf(busy)).toMatchObject({ retryable: true });

    const slow = FakeInstagram.happyPath().on('GET https://graph.instagram.com/v27.0/c*', () =>
      Response.json({ status_code: 'IN_PROGRESS' }),
    );
    const timeout = await errorOf(slow, { containerTimeoutMs: 0 });
    expect(timeout.retryable).toBe(true);
    expect(timeout.message).toMatch(/preparando/);

    const failed = FakeInstagram.happyPath().on('GET https://graph.instagram.com/v27.0/c*', () =>
      Response.json({ status_code: 'ERROR' }),
    );
    expect(await errorOf(failed)).toMatchObject({ retryable: false });

    const uncertain = FakeInstagram.happyPath().on(
      'POST https://graph.instagram.com/v27.0/1789/media_publish',
      () => new Response('{"error":{"message":"oops"}}', { status: 500 }),
    );
    const error = await errorOf(uncertain);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/Esito incerto/);

    const expired = FakeInstagram.happyPath().on(
      'POST https://graph.instagram.com/v27.0/1789/media_publish',
      () => new Response('{"error":{"message":"Invalid token","code":190}}', { status: 400 }),
    );
    expect((await errorOf(expired)).message).toMatch(/ricollega/);
  });

  it('se il link non arriva il post resta pubblicato con un avviso', async () => {
    const instagram = FakeInstagram.happyPath().on(
      'GET https://graph.instagram.com/v27.0/m-100',
      () => new Response('errore', { status: 500 }),
    );
    const result = await setup(instagram).adapter.publish(request());
    expect(result.externalId).toBe('m-100');
    expect(result.externalUrl).toBeNull();
    expect(result.warnings?.[0]).toMatch(/link/);
  });
});

describe('Instagram: metriche', () => {
  const account = { id: 1, externalId: '1789', accessToken: 'lungo-1' };

  it('insights del post; senza `views` se Instagram la rifiuta per quel media', async () => {
    const instagram = FakeInstagram.happyPath().on(
      'GET https://graph.instagram.com/v27.0/m-100/insights',
      (request) =>
        request.params.get('metric')!.includes('views')
          ? Response.json(
              { error: { message: 'metric views not supported', code: 100 } },
              { status: 400 },
            )
          : Response.json({
              data: [
                { name: 'reach', period: 'lifetime', values: [{ value: 6400 }] },
                { name: 'likes', values: [{ value: 410 }] },
                { name: 'comments', total_value: { value: 38 } },
                { name: 'shares', values: [{ value: 25 }] },
                { name: 'saved', values: [{ value: 65 }] },
              ],
            }),
    );
    const { adapter } = setup(instagram);
    const sample = await adapter.metrics!.post('m-100', account);
    expect(sample).toMatchObject({ reach: 6400, likes: 410, comments: 38, shares: 25, saves: 65 });
    expect(sample.views).toBeUndefined();
  });

  it('copertura giornaliera dell’account e follower del giorno', async () => {
    const instagram = FakeInstagram.happyPath()
      .on('GET https://graph.instagram.com/v27.0/1789/insights', (request) => {
        expect(Object.fromEntries(request.params)).toMatchObject({
          metric: 'reach',
          period: 'day',
          metric_type: 'time_series',
        });
        return Response.json({
          data: [
            {
              name: 'reach',
              values: [
                { value: 520, end_time: '2026-11-21T08:00:00+0000' },
                { value: 610, end_time: '2026-11-22T08:00:00+0000' },
              ],
            },
          ],
        });
      })
      .on('GET https://graph.instagram.com/v27.0/1789', () =>
        Response.json({ followers_count: 2140 }),
      );
    const { adapter } = setup(instagram);
    expect(await adapter.metrics!.account(account, '2026-11-20', '2026-11-22')).toEqual([
      { day: '2026-11-20', reach: 520 },
      { day: '2026-11-21', reach: 610 },
      { day: '2026-11-22', followers: 2140 },
    ]);
  });
});
