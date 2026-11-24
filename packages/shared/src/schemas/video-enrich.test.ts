import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_EDIT } from './video-edit.js';
import { VideoProjectSchema, videoRenderKey } from './video.js';
import { bestStockItem, enrichOverlays, filenameScore, type StockItem } from './video-enrich.js';
import { brollAt, limitCode, overlayAt } from './video-overlays.js';

const segments = [
  { startMs: 0, endMs: 3000, text: 'Oggi parliamo di Rust.' },
  { startMs: 3500, endMs: 12_000, text: 'Ecco come gestisco gli errori con match.' },
  { startMs: 12_500, endMs: 13_200, text: 'Ok.' },
];

describe('B-roll e testi', () => {
  it('trasforma la proposta in schede e ricerche di B-roll', () => {
    const { overlays, brollRequests } = enrichOverlays(segments, {
      overlays: [
        { segment: 0, kind: 'title', title: 'Rust in pratica', body: '', code: '' },
        {
          segment: 1,
          kind: 'code',
          title: 'Errori con match',
          body: '',
          code: Array.from({ length: 12 }, (_, i) => `riga ${i}`).join('\n'),
        },
        { segment: 9, kind: 'title', title: 'Inesistente', body: '', code: '' },
      ],
      broll: [
        { segment: 2, query: 'keyboard typing' },
        { segment: 1, query: 'server room' },
      ],
    });
    expect(overlays.map((o) => [o.kind, o.startMs, o.endMs])).toEqual([
      ['title', 0, 3000],
      ['code', 3500, 12_000],
    ]);
    expect(overlays[1]!.code.split('\n')).toHaveLength(8);
    // Frase corta allungata a 1,5 s, frase lunga tagliata a 8 s.
    expect(brollRequests).toEqual([
      { startMs: 12_500, endMs: 14_000, query: 'keyboard typing' },
      { startMs: 3500, endMs: 11_500, query: 'server room' },
    ]);
    expect(overlayAt(overlays, 4000)?.kind).toBe('code');
    expect(overlayAt(overlays, 12_100)).toBeNull();
    expect(brollAt([], 0)).toBeNull();
    expect(limitCode('a\nb  ')).toBe('a\nb');
  });

  it('sceglie il risultato dell’archivio adatto al formato e alla durata', () => {
    const item = (id: number, width: number, height: number, durationMs: number): StockItem => ({
      id,
      kind: 'video',
      pageUrl: `https://pixabay.com/videos/id-${id}/`,
      user: 'autore',
      tags: 'code',
      previewUrl: '',
      downloadUrl: `https://cdn.pixabay.com/video/${id}.mp4`,
      width,
      height,
      durationMs,
    });
    const items = [
      item(1, 1920, 1080, 20_000),
      item(2, 1080, 1920, 4000),
      item(3, 1080, 1920, 15_000),
    ];
    expect(bestStockItem(items, 6000, 'vertical')?.id).toBe(3);
    expect(bestStockItem(items, 6000, 'horizontal')?.id).toBe(1);
    expect(bestStockItem([item(4, 1080, 1920, 2000)], 6000, 'vertical')).toBeNull();
  });

  it('trova i file della cartella dal nome', () => {
    expect(filenameScore('tastiera-codice_notte.mp4', 'codice tastiera')).toBe(2);
    expect(filenameScore('Città di notte.jpg', 'citta')).toBe(1);
    expect(filenameScore('mare.mp4', 'server room')).toBe(0);
  });

  it('i progetti senza schede né B-roll tengono la stessa chiave del render', () => {
    const at = '2026-11-24T10:00:00.000Z';
    const project = VideoProjectSchema.parse({
      id: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
      title: 't',
      source: {
        path: 'v.mp4',
        fileName: 'v.mp4',
        sizeBytes: 1,
        durationMs: 1000,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: 'h264',
        hasAudio: true,
      },
      createdAt: at,
      updatedAt: at,
    });
    expect(videoRenderKey(project)).not.toContain('overlays');
    const withCard = {
      ...project,
      edit: {
        ...DEFAULT_VIDEO_EDIT,
        overlays: [
          {
            id: 'a',
            kind: 'title' as const,
            title: 'T',
            body: '',
            code: '',
            startMs: 0,
            endMs: 2000,
          },
        ],
      },
    };
    expect(videoRenderKey(withCard)).toContain('overlays');
  });
});
