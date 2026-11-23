import type { Variant } from '@prisma-app/shared';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeYouTube } from '../../../test/helpers/fake-youtube.js';
import { PublishError, type PublishMedia, type PublishRequest } from '../types.js';
import { createYouTubeAdapter, descriptionOf } from './adapter.js';
import { authorizationUrl, createYouTubeClient, uploadedFromRange } from './client.js';

const BYTES = Buffer.from('x'.repeat(1000));

function variant(
  patch: Partial<Variant> = {},
  metadata: Partial<Variant['metadata']> = {},
): Variant {
  return {
    id: 1,
    contentId: 1,
    platform: 'youtube',
    format: 'short',
    body: 'Annuncio per la community.',
    metadata: {
      hashtags: ['#mysql', '#database'],
      title: 'Query 1500 volte più veloce',
      description: 'Come un indice composto ha salvato la mia app.',
      ...metadata,
    },
    status: 'in_pubblicazione',
    version: 6,
    approvedAt: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    ...patch,
  };
}

function video(patch: Partial<PublishMedia> = {}): PublishMedia {
  return {
    assetId: 9,
    kind: 'video',
    role: 'media',
    position: 0,
    mime: 'video/mp4',
    sizeBytes: BYTES.length,
    width: 1080,
    height: 1920,
    durationMs: 28_000,
    checksumSha256: 'a'.repeat(64),
    localPath: null,
    remoteKey: 'brand-1/a.mp4',
    remoteUrl: null,
    upToDate: true,
    ...patch,
  };
}

function setup() {
  const youtube = new FakeYouTube();
  const client = createYouTubeClient({ fetch: youtube.fetch, put: youtube.put });
  const opened: number[] = [];
  const adapter = createYouTubeAdapter(client, {
    openObject: async (_key, start) => {
      opened.push(start);
      return Readable.from([BYTES.subarray(start)]);
    },
    retryDelayMs: 0,
  });
  let session: string | null = null;
  const request = (patch: Partial<PublishRequest> = {}): PublishRequest => ({
    publicationId: 3,
    idempotencyKey: 'k'.repeat(64),
    variant: variant(),
    account: { id: 1, externalId: 'UC123', accessToken: 'accesso' },
    media: [video()],
    uploadSession: {
      get: () => session,
      save: async (value) => {
        session = value;
      },
    },
    ...patch,
  });
  return { youtube, adapter, opened, request, session: () => session };
}

describe('YouTube: controlli', () => {
  const { adapter } = setup();

  it('chiede titolo, video su R2 e rispetta i limiti', () => {
    expect(adapter.validate(variant(), [video()])).toEqual([
      { level: 'ok', message: 'Video su R2 (0 MB)' },
    ]);
    const errors = (v: Variant, media = [video()]) =>
      adapter
        .validate(v, media)
        .filter((i) => i.level === 'error')
        .map((i) => i.message);
    expect(errors(variant({}, { title: '' }))).toEqual(['Manca il titolo del video']);
    expect(errors(variant({}, { title: 'x'.repeat(101) }))).toEqual(['Titolo oltre 100 caratteri']);
    expect(errors(variant({}, { title: 'a < b' }))).toEqual([
      'Titolo e descrizione non possono contenere < o >',
    ]);
    expect(errors(variant({}, { description: 'è'.repeat(2600) }))[0]).toMatch(
      /byte: il massimo è 5000/,
    );
    expect(errors(variant(), [])).toEqual(['Nessun video collegato: esportalo dall’editor video']);
    expect(errors(variant(), [video({ remoteKey: null })])).toEqual([
      'Il video non è ancora caricato su R2',
    ]);
    expect(errors(variant({ format: 'post' }))).toEqual([
      'Formato post non pubblicabile su YouTube',
    ]);
  });

  it('avvisa per gli Short non verticali o lunghi e per il commento fissato', () => {
    const warnings = adapter
      .validate(variant({}, { firstComment: 'Tu che ne pensi?' }), [
        video({ width: 1920, height: 1080, durationMs: 200_000 }),
      ])
      .filter((i) => i.level === 'warning')
      .map((i) => i.message);
    expect(warnings).toEqual([
      'Per uno Short serve un video verticale',
      'Video oltre 3 minuti: YouTube potrebbe non trattarlo come Short',
      'Il commento fissato non viene pubblicato in automatico',
    ]);
  });

  it('descrizione con gli hashtag in fondo; OAuth offline con consenso', () => {
    expect(descriptionOf(variant())).toBe(
      'Come un indice composto ha salvato la mia app.\n\n#mysql #database',
    );
    const url = new URL(
      authorizationUrl({ clientId: 'c', redirectUri: 'http://localhost/cb', state: 's' }),
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/yt-analytics.readonly',
    );
    expect(uploadedFromRange('bytes=0-499')).toBe(500);
    expect(uploadedFromRange(null)).toBe(0);
  });
});

describe('YouTube: caricamento', () => {
  it('pubblica subito: sessione salvata prima dei byte, poi azzerata', async () => {
    const { youtube, adapter, request, session } = setup();
    const result = await adapter.publish(request());
    expect(result).toEqual({ externalId: 'v1', externalUrl: 'https://www.youtube.com/watch?v=v1' });
    expect(youtube.videos.get('v1')).toMatchObject({
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      snippet: {
        title: 'Query 1500 volte più veloce',
        tags: ['mysql', 'database'],
        categoryId: '28',
      },
    });
    expect(youtube.sessions.get('s1')!.received.equals(BYTES)).toBe(true);
    expect(session()).toBeNull();
  });

  it('caricamento anticipato: privato con publishAt all’orario programmato', async () => {
    const { youtube, adapter, request } = setup();
    const scheduledAt = new Date('2026-11-25T17:30:00.000Z');
    await adapter.advance!.prepare({ ...request(), scheduledAt });
    expect(youtube.videos.get('v1')!.status).toEqual({
      privacyStatus: 'private',
      publishAt: '2026-11-25T17:30:00.000Z',
      selfDeclaredMadeForKids: false,
    });
  });

  it('connessione caduta a metà: chiede a YouTube quanti byte ha e riprende da lì', async () => {
    const { youtube, adapter, opened, request } = setup();
    youtube.putBehaviours.push('drop-half');
    const result = await adapter.publish(request());
    expect(result.externalId).toBe('v1');
    expect(opened).toEqual([0, 500]);
    expect(youtube.sessions.size).toBe(1);
    expect(youtube.sessions.get('s1')!.received.equals(BYTES)).toBe(true);
  });

  it('risposta persa dopo il caricamento completo: nessun secondo video', async () => {
    const { youtube, adapter, request } = setup();
    youtube.putBehaviours.push('lost-response');
    const result = await adapter.publish(request());
    expect(result.externalId).toBe('v1');
    expect(youtube.videos.size).toBe(1);
    expect(youtube.sessions.size).toBe(1);
  });

  it('un tentativo nuovo riprende la sessione salvata invece di aprirne un’altra', async () => {
    const { youtube, adapter, request, session } = setup();
    youtube.putBehaviours.push('error-500', 'error-500', 'error-500', 'error-500');
    await expect(adapter.publish(request())).rejects.toMatchObject({ retryable: true });
    expect(session()).toBe('https://upload.test/session/s1');
    const result = await adapter.publish(request());
    expect(result.externalId).toBe('v1');
    expect(youtube.sessions.size).toBe(1);
  });

  it('quota esaurita: errore definitivo', async () => {
    const { adapter, request } = setup();
    const client = createYouTubeClient({
      fetch: async () =>
        Response.json(
          { error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } },
          { status: 403 },
        ),
    });
    const failing = createYouTubeAdapter(client, {
      openObject: async () => Readable.from([BYTES]),
    });
    const error = await failing.publish(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({
      retryable: false,
      message: expect.stringContaining('limite giornaliero'),
    });
    void adapter;
  });
});

describe('YouTube: uscita, Annulla e Sposta', () => {
  it('all’orario rende pubblico il video caricato; se è già pubblico non lo tocca', async () => {
    const { youtube, adapter, request } = setup();
    await adapter.advance!.prepare({ ...request(), scheduledAt: new Date('2026-11-25T17:30:00Z') });
    const result = await adapter.advance!.finalize({ ...request(), externalId: 'v1' });
    expect(result.externalUrl).toBe('https://www.youtube.com/watch?v=v1');
    expect(youtube.videos.get('v1')!.status).toEqual({
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
    });
    const before = youtube.calls.length;
    await adapter.advance!.finalize({ ...request(), externalId: 'v1' });
    expect(youtube.calls.slice(before)).toEqual(['GET /youtube/v3/videos']);
  });

  it('sposta l’uscita e la annulla cancellando il video', async () => {
    const { youtube, adapter, request } = setup();
    const account = request().account;
    await adapter.advance!.prepare({ ...request(), scheduledAt: new Date('2026-11-25T17:30:00Z') });
    await adapter.advance!.reschedule(account, 'v1', new Date('2026-11-26T08:00:00Z'));
    expect(youtube.videos.get('v1')!.status.publishAt).toBe('2026-11-26T08:00:00.000Z');
    await adapter.advance!.withdraw(account, 'v1');
    expect(youtube.videos.has('v1')).toBe(false);
    // Già cancellato: nessun errore.
    await adapter.advance!.withdraw(account, 'v1');
    await expect(adapter.advance!.finalize({ ...request(), externalId: 'v1' })).rejects.toThrow(
      /non esiste più/,
    );
  });
});

describe('YouTube: metriche', () => {
  it('contatori del video e rapporto giornaliero del canale', async () => {
    const { youtube, adapter, request } = setup();
    await adapter.publish(request());
    const account = request().account;
    expect(await adapter.metrics!.post('v1', account)).toMatchObject({
      views: 1520,
      likes: 96,
      comments: 12,
    });
    await expect(adapter.metrics!.post('sparito', account)).rejects.toThrow(/non esiste più/);

    expect(await adapter.metrics!.account(account, '2026-11-20', '2026-11-22')).toEqual([
      { day: '2026-11-20', views: 340, followersGained: 5, followersLost: 1 },
      { day: '2026-11-21', views: 410, followersGained: 7, followersLost: 0 },
      { day: '2026-11-22', followers: 1250 },
    ]);
    expect(Object.fromEntries(youtube.analyticsQueries[0]!)).toMatchObject({
      ids: 'channel==MINE',
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      metrics: 'views,subscribersGained,subscribersLost',
      dimensions: 'day',
    });
  });
});
