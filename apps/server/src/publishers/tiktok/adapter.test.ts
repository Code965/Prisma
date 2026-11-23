import type { Variant } from '@prisma-app/shared';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeTikTok } from '../../../test/helpers/fake-tiktok.js';
import type { PublishMedia, PublishRequest } from '../types.js';
import { INBOX_NOTICE, createTikTokAdapter } from './adapter.js';
import { authorizationUrl, chunkPlan, createTikTokClient } from './client.js';

const MB = 1024 * 1024;

function variant(patch: Partial<Variant> = {}): Variant {
  return {
    id: 1,
    contentId: 1,
    platform: 'tiktok',
    format: 'video',
    body: 'Da 30 secondi a 20 millisecondi',
    metadata: { hashtags: ['#mysql'] },
    status: 'in_pubblicazione',
    version: 6,
    approvedAt: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    ...patch,
  };
}

function video(bytes: Buffer, patch: Partial<PublishMedia> = {}): PublishMedia {
  return {
    assetId: 9,
    kind: 'video',
    role: 'media',
    position: 0,
    mime: 'video/mp4',
    sizeBytes: bytes.length,
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

function setup(bytes = Buffer.alloc(3000, 7)) {
  const tiktok = new FakeTikTok();
  const client = createTikTokClient({ fetch: tiktok.fetch, put: tiktok.put });
  const ranges: Array<[number, number]> = [];
  const adapter = createTikTokAdapter(client, {
    openRange: async (_key, start, end) => {
      ranges.push([start, end]);
      return Readable.from([bytes.subarray(start, end + 1)]);
    },
    pollMs: 0,
    maxWaitMs: 50,
    retryDelayMs: 0,
  });
  let session: string | null = null;
  const request = (): PublishRequest => ({
    publicationId: 4,
    idempotencyKey: 'k'.repeat(64),
    variant: variant(),
    account: { id: 1, externalId: 'open-123', accessToken: 'accesso-1' },
    media: [video(bytes)],
    uploadSession: {
      get: () => session,
      save: async (value) => {
        session = value;
      },
    },
  });
  return { tiktok, adapter, ranges, request, session: () => session, bytes };
}

describe('TikTok: controlli', () => {
  const { adapter, bytes } = setup();

  it('vuole un video su R2 entro i limiti della casella e avvisa che si completa nell’app', () => {
    expect(adapter.validate(variant(), [video(bytes)])).toEqual([
      { level: 'ok', message: 'Video su R2 (0 MB)' },
      {
        level: 'warning',
        message: 'Arriva nella casella di TikTok: didascalia e privacy le scegli tu nell’app',
      },
    ]);
    const errors = (v: Variant, media: PublishMedia[]) =>
      adapter
        .validate(v, media)
        .filter((i) => i.level === 'error')
        .map((i) => i.message);
    expect(errors(variant({ format: 'carosello' }), [])[0]).toMatch(
      /Caroselli TikTok non ancora supportati/,
    );
    expect(errors(variant(), [])).toEqual(['Nessun video collegato: esportalo dall’editor video']);
    expect(errors(variant(), [video(bytes, { durationMs: 11 * 60_000 })])).toEqual([
      'Video oltre 10 minuti: la casella di TikTok non lo accetta',
    ]);
    expect(errors(variant(), [video(bytes, { mime: 'video/x-matroska' })])[0]).toMatch(
      /non accettato/,
    );
  });

  it('pezzi del caricamento secondo la guida: uno solo fino a 64 MB, avanzo nell’ultimo', () => {
    expect(chunkPlan(3000)).toEqual({ chunkSize: 3000, count: 1, ranges: [[0, 2999]] });
    const big = chunkPlan(95 * MB + 123);
    expect(big.count).toBe(9);
    expect(big.ranges[0]).toEqual([0, 10 * MB - 1]);
    expect(big.ranges.at(-1)).toEqual([80 * MB, 95 * MB + 122]);
    const url = new URL(
      authorizationUrl({ clientKey: 'ck', redirectUri: 'https://x.test/cb', state: 's' }),
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_key: 'ck',
      scope: 'user.info.basic,video.upload,video.list,user.info.stats',
      response_type: 'code',
    });
  });
});

describe('TikTok: casella', () => {
  it('carica il video, attende la notifica e restituisce il publish_id con l’avviso', async () => {
    const { tiktok, adapter, request, session, bytes } = setup();
    const result = await adapter.publish(request());
    expect(result).toEqual({
      externalId: 'v_inbox_file~1',
      externalUrl: null,
      warnings: [INBOX_NOTICE],
    });
    expect(tiktok.uploads.get('v_inbox_file~1')!.received.equals(bytes)).toBe(true);
    expect(session()).toBeNull();
  });

  it('elaborazione lenta: al tentativo dopo si controlla lo stato senza ricaricare', async () => {
    const { tiktok, adapter, request, session } = setup();
    tiktok.statuses = ['PROCESSING_UPLOAD'];
    await expect(adapter.publish(request())).rejects.toMatchObject({ retryable: true });
    expect(JSON.parse(session()!)).toEqual({ publishId: 'v_inbox_file~1', uploaded: true });
    tiktok.uploads.get('v_inbox_file~1')!.statuses = ['SEND_TO_USER_INBOX'];
    const result = await adapter.publish(request());
    expect(result.externalId).toBe('v_inbox_file~1');
    expect(tiktok.uploads.size).toBe(1);
  });

  it('5 video già in attesa nella casella: errore definitivo con la spiegazione', async () => {
    const { tiktok, adapter, request } = setup();
    tiktok.initError = { status: 403, code: 'spam_risk_too_many_pending_share' };
    await expect(adapter.publish(request())).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('5 video in attesa'),
    });
  });

  it('video rifiutato: definitivo, salvo errore interno di TikTok', async () => {
    const { tiktok, adapter, request } = setup();
    tiktok.statuses = ['FAILED'];
    tiktok.failReason = 'duration_check_failed';
    await expect(adapter.publish(request())).rejects.toMatchObject({ retryable: false });
    tiktok.failReason = 'internal';
    await expect(adapter.publish(request())).rejects.toMatchObject({ retryable: true });
  });
});

describe('TikTok: metriche', () => {
  it('dal publish_id al post pubblico: id e link aggiornati, poi solo l’id del video', async () => {
    const { tiktok, adapter, request } = setup();
    await adapter.publish(request());
    const account = request().account;
    await expect(adapter.metrics!.post('v_inbox_file~1', account)).rejects.toThrow(/casella/);

    tiktok.postIds = ['7311'];
    const sample = await adapter.metrics!.post('v_inbox_file~1', account);
    expect(sample).toMatchObject({
      views: 18200,
      likes: 1100,
      comments: 90,
      shares: 50,
      resolved: { externalId: '7311', externalUrl: 'https://www.tiktok.com/@d/video/7311' },
    });
    expect(sample.reach).toBeUndefined();
    expect((await adapter.metrics!.post('7311', account)).resolved).toBeUndefined();
    expect(await adapter.metrics!.account(account, '2026-11-20', '2026-11-22')).toEqual([
      { day: '2026-11-22', followers: 830 },
    ]);
  });
});
