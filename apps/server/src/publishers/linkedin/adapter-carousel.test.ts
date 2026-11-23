import type { Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { FakeLinkedIn } from '../../../test/helpers/fake-linkedin.js';
import { PublishError, type PublishMedia, type PublishRequest } from '../types.js';
import { createLinkedInAdapter, type LinkedInAdapterOptions } from './adapter.js';
import { createLinkedInClient } from './client.js';

const PDF = Buffer.from('%PDF-1.7 carosello di prova');

function variant(): Variant {
  return {
    id: 1,
    contentId: 1,
    platform: 'linkedin',
    format: 'carosello',
    body: 'Tre cose che rifarei in un client database.',
    metadata: {
      hashtags: ['#dotnet'],
      carousel: {
        template: 'scuro',
        kicker: 'client-db',
        slides: [{ kind: 'cover', title: 'Ho costruito un client database', body: '', code: '' }],
      },
    },
    status: 'in_pubblicazione',
    version: 6,
    approvedAt: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
  };
}

function pdf(patch: Partial<PublishMedia> = {}): PublishMedia {
  return {
    assetId: 5,
    kind: 'pdf',
    role: 'media',
    position: 0,
    mime: 'application/pdf',
    sizeBytes: PDF.length,
    width: 1080,
    height: 1350,
    durationMs: null,
    checksumSha256: 'a'.repeat(64),
    localPath: 'C:\\carosello.pdf',
    remoteKey: 'brand-1/aaa.pdf',
    remoteUrl: null,
    upToDate: true,
    ...patch,
  };
}

function request(media: PublishMedia[] = [pdf()]): PublishRequest {
  return {
    publicationId: 9,
    idempotencyKey: 'k'.repeat(64),
    variant: variant(),
    account: { id: 1, externalId: 'abc123', accessToken: 'access-123' },
    media,
  };
}

function setup(linkedin = FakeLinkedIn.happyPath(), options: LinkedInAdapterOptions = {}) {
  const client = createLinkedInClient({ apiVersion: '202611', fetch: linkedin.fetch });
  const adapter = createLinkedInAdapter(client, {
    readObject: async (key) => {
      if (key !== 'brand-1/aaa.pdf') throw new Error('chiave inattesa');
      return PDF;
    },
    sleep: async () => {},
    ...options,
  });
  return { linkedin, adapter };
}

describe('LinkedIn: caroselli PDF', () => {
  it('controlla PDF esportato, aggiornato e caricato', () => {
    const { adapter } = setup();
    const errors = (media: PublishMedia[]) =>
      adapter
        .validate(variant(), media)
        .filter((i) => i.level === 'error')
        .map((i) => i.message);
    expect(errors([pdf()])).toEqual([]);
    expect(errors([])[0]).toMatch(/esportalo/);
    expect(errors([pdf({ upToDate: false })])[0]).toMatch(/esportalo di nuovo/);
    expect(errors([pdf({ remoteKey: null })])[0]).toMatch(/caricato su R2/);
    expect(errors([pdf({ kind: 'image', mime: 'image/png' })])[0]).toMatch(/Manca il PDF/);

    const withoutStorage = createLinkedInAdapter(createLinkedInClient({ apiVersion: '202611' }));
    expect(withoutStorage.validate(variant(), [pdf()])[0]!.message).toMatch(/Storage R2/);
  });

  it('carica il documento, attende che sia pronto e crea il post con content.media', async () => {
    let checks = 0;
    const linkedin = FakeLinkedIn.happyPath().on('https://api.linkedin.com/rest/documents/', () =>
      Response.json({ status: ++checks < 2 ? 'PROCESSING' : 'AVAILABLE' }),
    );
    const { adapter } = setup(linkedin);
    const result = await adapter.publish(request());
    expect(result.externalId).toBe('urn:li:share:7000');

    const [init, upload, , , post] = linkedin.requests;
    expect(init!.url).toBe('https://api.linkedin.com/rest/documents?action=initializeUpload');
    expect(JSON.parse(init!.body)).toEqual({
      initializeUploadRequest: { owner: 'urn:li:person:abc123' },
    });
    expect(init!.headers['linkedin-version']).toBe('202611');
    expect(upload).toMatchObject({ method: 'PUT', bodyBytes: PDF.length });
    expect(upload!.url).toMatch(/^https:\/\/www\.linkedin\.com\/dms-uploads\//);
    expect(upload!.headers.authorization).toBe('Bearer access-123');
    expect(checks).toBe(2);
    expect(JSON.parse(post!.body)).toMatchObject({
      author: 'urn:li:person:abc123',
      content: { media: { id: 'urn:li:document:D1', title: 'Ho costruito un client database' } },
      lifecycleState: 'PUBLISHED',
    });
  });

  it('prima del post ritenta gli errori temporanei, non quelli definitivi', async () => {
    const failing = (status: number) =>
      FakeLinkedIn.happyPath().on(
        'https://www.linkedin.com/dms-uploads/',
        () => new Response('errore', { status }),
      );
    const errorOf = async (linkedin: FakeLinkedIn, options: LinkedInAdapterOptions = {}) => {
      const { adapter } = setup(linkedin, options);
      return (await adapter.publish(request()).catch((e: unknown) => e)) as PublishError;
    };

    const temporary = await errorOf(failing(503));
    expect(temporary).toBeInstanceOf(PublishError);
    expect(temporary.retryable).toBe(true);
    expect((await errorOf(failing(403))).retryable).toBe(false);

    const failed = FakeLinkedIn.happyPath().on('https://api.linkedin.com/rest/documents/', () =>
      Response.json({ status: 'PROCESSING_FAILED' }),
    );
    expect(await errorOf(failed)).toMatchObject({ retryable: false });

    const slow = FakeLinkedIn.happyPath().on('https://api.linkedin.com/rest/documents/', () =>
      Response.json({ status: 'PROCESSING' }),
    );
    const timeout = await errorOf(slow, { documentTimeoutMs: 0 });
    expect(timeout).toMatchObject({ retryable: true });
    expect(timeout.message).toMatch(/elaborando/);
  });

  it('non manda mai il token fuori da LinkedIn', async () => {
    const hostile = FakeLinkedIn.happyPath().on(
      'https://api.linkedin.com/rest/documents?action=initializeUpload',
      () =>
        Response.json({
          value: { uploadUrl: 'https://evil.example/upload', document: 'urn:li:document:X' },
        }),
    );
    const { adapter, linkedin } = setup(hostile);
    await expect(adapter.publish(request())).rejects.toBeInstanceOf(PublishError);
    expect(linkedin.requests.some((r) => r.url.startsWith('https://evil.example'))).toBe(false);
  });
});
