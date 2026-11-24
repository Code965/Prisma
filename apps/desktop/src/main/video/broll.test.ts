import type { StockItem } from '@prisma-app/shared';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  brollKeyFromUrl,
  brollPathFromKey,
  brollUrl,
  createBrollLibrary,
  isBrollPathAllowed,
  isPixabayDownloadUrl,
  pixabayFileName,
} from './broll.js';

const item: StockItem = {
  id: 125,
  kind: 'video',
  pageUrl: 'https://pixabay.com/videos/id-125/',
  user: 'Coverr-Free-Footage',
  tags: 'keyboard',
  previewUrl: '',
  downloadUrl: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4',
  width: 1920,
  height: 1080,
  durationMs: 12_000,
};

describe('B-roll', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('serve solo file della cartella e della cache di Pixabay', () => {
    const folder = join('C:', 'Broll');
    const cache = join('C:', 'dati', 'broll-pixabay');
    expect(brollPathFromKey('cartella/città.mp4', folder, cache)).toBe(join(folder, 'città.mp4'));
    expect(brollPathFromKey('cartella/../segreti.mp4', folder, cache)).toBeNull();
    expect(brollPathFromKey('cartella/note.txt', folder, cache)).toBeNull();
    expect(brollPathFromKey('pixabay/pixabay-125.mp4', folder, cache)).toBe(
      join(cache, 'pixabay-125.mp4'),
    );
    expect(brollPathFromKey('pixabay/altro.mp4', folder, cache)).toBeNull();
    expect(isBrollPathAllowed(join(folder, 'a.jpg'), folder, cache)).toBe(true);
    expect(isBrollPathAllowed(join('C:', 'Altro', 'a.jpg'), folder, cache)).toBe(false);
    expect(brollKeyFromUrl(brollUrl('cartella/città di notte.mp4'))).toBe(
      'cartella/città di notte.mp4',
    );
  });

  it('scarica solo da Pixabay in https', () => {
    expect(isPixabayDownloadUrl(item.downloadUrl)).toBe(true);
    expect(isPixabayDownloadUrl('http://cdn.pixabay.com/a.mp4')).toBe(false);
    expect(isPixabayDownloadUrl('https://pixabay.com.evil.example/a.mp4')).toBe(false);
    expect(pixabayFileName(item)).toBe('pixabay-125.mp4');
    expect(
      pixabayFileName({
        ...item,
        kind: 'image',
        downloadUrl: 'https://pixabay.com/get/x_1280.png',
      }),
    ).toBe('pixabay-125.png');
  });

  it('elenca la cartella e scarica una volta sola nella cache', async () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-broll-'));
    const folder = join(dir, 'broll');
    mkdirSync(folder);
    writeFileSync(join(folder, 'tastiera.mp4'), 'v');
    writeFileSync(join(folder, 'città.jpg'), 'i');
    writeFileSync(join(folder, 'note.txt'), 'x');
    let downloads = 0;
    const library = createBrollLibrary({
      settingsFile: join(dir, 'broll.json'),
      cacheDir: join(dir, 'broll-pixabay'),
      ffprobe: async () => 'ffprobe',
      probe: async () => ({ width: 1920, height: 1080, durationMs: 7000 }),
      fetch: (async () => {
        downloads++;
        return new Response('video finto');
      }) as unknown as typeof fetch,
    });
    const status = await library.setDir(folder);
    expect(status.items.map((m) => [m.key, m.kind, m.durationMs])).toEqual([
      ['cartella/città.jpg', 'image', 0],
      ['cartella/tastiera.mp4', 'video', 7000],
    ]);
    const media = await library.download(item);
    expect(media).toMatchObject({
      key: 'pixabay/pixabay-125.mp4',
      source: 'pixabay',
      credit: 'Video di Coverr-Free-Footage da Pixabay',
      pageUrl: 'https://pixabay.com/videos/id-125/',
    });
    expect(existsSync(media.path)).toBe(true);
    await library.download(item);
    expect(downloads).toBe(1);
    expect(await library.isAllowed(media.path)).toBe(true);
    await expect(
      library.download({ ...item, downloadUrl: 'https://example.com/a.mp4' }),
    ).rejects.toThrow(/solo file di Pixabay/);
  });
});
