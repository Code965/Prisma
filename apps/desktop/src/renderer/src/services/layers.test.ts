import type { Broll, BrollMedia, Overlay, StockItem } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  enrichToast,
  formatOrientation,
  newOverlay,
  pickFolderMedia,
  pickStockItem,
} from './enrich';
import {
  brollFolderLabel,
  brollPreviewSeconds,
  layerBlocks,
  rangeLabel,
  removeById,
  replaceById,
} from './layers';

const media = (fileName: string, kind: 'video' | 'image', durationMs: number): BrollMedia => ({
  key: `cartella/${fileName}`,
  path: `C:\\B\\${fileName}`,
  fileName,
  kind,
  width: 1920,
  height: 1080,
  durationMs,
  source: 'cartella',
  credit: null,
  pageUrl: null,
});

describe('B-roll e schede nell’editor', () => {
  it('sceglie il file della cartella dal nome, prima i video lunghi abbastanza', () => {
    const items = [
      media('server-room-corto.mp4', 'video', 2000),
      media('server-room-lungo.mp4', 'video', 9000),
      media('mare.jpg', 'image', 0),
    ];
    expect(pickFolderMedia(items, 'server room lights', 6000)?.fileName).toBe(
      'server-room-lungo.mp4',
    );
    expect(pickFolderMedia(items, 'city traffic', 6000)).toBeNull();
  });

  it('da Pixabay un video, se no una foto', () => {
    const stock = (
      id: number,
      kind: 'video' | 'image',
      width: number,
      height: number,
      durationMs: number,
    ): StockItem => ({
      id,
      kind,
      pageUrl: '',
      user: '',
      tags: '',
      previewUrl: '',
      downloadUrl: '',
      width,
      height,
      durationMs,
    });
    expect(pickStockItem([stock(1, 'video', 1080, 1920, 10_000)], [], 5000, '9:16')?.id).toBe(1);
    expect(
      pickStockItem(
        [stock(1, 'video', 1080, 1920, 2000)],
        [stock(2, 'image', 720, 1280, 0)],
        5000,
        '9:16',
      )?.id,
    ).toBe(2);
    expect(formatOrientation('1:1')).toBe('square');
  });

  it('riepilogo per l’avviso', () => {
    expect(
      enrichToast({ overlays: 2, fromFolder: 1, fromPixabay: 2, missing: 0, stockOff: false }),
    ).toBe(
      '2 schede di testo · 3 B-roll (1 dalla tua cartella, 2 da Pixabay). Controlla prima di esportare.',
    );
    expect(
      enrichToast({ overlays: 0, fromFolder: 0, fromPixabay: 0, missing: 2, stockOff: true }),
    ).toMatch(/2 ricerche senza file: aggiungi la chiave di Pixabay/);
  });

  it('scheda aggiunta a mano, blocchi della timeline, elenco', () => {
    const card = newOverlay('title', 59_000, 60_000);
    expect(card).toMatchObject({ kind: 'title', startMs: 58_500, endMs: 60_000 });
    const overlay: Overlay = {
      id: 'o',
      kind: 'code',
      title: 'T',
      body: '',
      code: 'match x {}\nfine',
      startMs: 10_000,
      endMs: 15_000,
    };
    const broll: Broll = {
      id: 'b',
      startMs: 0,
      endMs: 5000,
      media: media('a.mp4', 'video', 2000),
      query: 'keyboard',
    };
    expect(layerBlocks([overlay], [broll], 20_000)).toEqual([
      { id: 'b', kind: 'broll', label: 'B-roll: keyboard', left: 0, width: 25 },
      { id: 'o', kind: 'overlay', label: 'Codice: match x {}', left: 50, width: 25 },
    ]);
    expect(brollPreviewSeconds(broll, 3500)).toBe(1.5);
    expect(rangeLabel(overlay)).toBe('0:10 · 5,0 s');
    expect(replaceById([overlay], { ...overlay, title: 'N' })[0]!.title).toBe('N');
    expect(removeById([overlay], 'o')).toEqual([]);
    expect(brollFolderLabel({ dir: 'C:\\B', items: [1, 2, 3], error: null })).toBe('3 file');
  });
});
