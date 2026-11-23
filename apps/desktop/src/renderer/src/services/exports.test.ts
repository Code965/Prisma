import type { VariantAsset } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { exportSummaries, formatSize, pendingUploads } from './exports';

const asset = (patch: Partial<VariantAsset>): VariantAsset => ({
  assetId: 1,
  kind: 'image',
  role: 'media',
  position: 0,
  mime: 'image/jpeg',
  sizeBytes: 200_000,
  width: 1080,
  height: 1350,
  durationMs: null,
  checksumSha256: 'x',
  localPath: 'C:/esportazioni/slide-01.jpg',
  remoteKey: null,
  remoteUrl: null,
  upToDate: true,
  ...patch,
});

describe('exportSummaries', () => {
  it('riassume immagini e PDF, con aggiornamento e caricamento', () => {
    const summaries = exportSummaries([
      asset({ position: 0, remoteKey: 'brand-1/a.jpg' }),
      asset({ position: 1, upToDate: false }),
      asset({
        kind: 'pdf',
        mime: 'application/pdf',
        sizeBytes: 1_572_864,
        localPath: 'C:/c.pdf',
        remoteKey: 'brand-1/c.pdf',
      }),
      asset({ role: 'copertina' }),
    ]);
    expect(summaries).toEqual([
      {
        format: 'jpg',
        label: '2 immagini JPEG',
        upToDate: false,
        uploaded: false,
        firstPath: 'C:/esportazioni/slide-01.jpg',
      },
      {
        format: 'pdf',
        label: 'PDF di 1,5 MB',
        upToDate: true,
        uploaded: true,
        firstPath: 'C:/c.pdf',
      },
    ]);
    expect(exportSummaries([])).toEqual([]);
  });

  it('scrive le dimensioni in KB o MB', () => {
    expect(formatSize(300)).toBe('1 KB');
    expect(formatSize(200_000)).toBe('195 KB');
  });
});

describe('pendingUploads', () => {
  it('carica solo i file aggiornati, sul computer e non ancora su R2', () => {
    const list = [
      asset({ assetId: 1 }),
      asset({ assetId: 2, remoteKey: 'brand-1/x.jpg' }),
      asset({ assetId: 3, upToDate: false }),
      asset({ assetId: 4, localPath: null }),
    ];
    expect(pendingUploads(list).map((a) => a.assetId)).toEqual([1]);
  });
});
