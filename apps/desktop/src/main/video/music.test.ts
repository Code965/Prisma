import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMusicLibrary, isTrackInFolder, musicFileFromUrl, musicUrl } from './music.js';

describe('cartella della musica', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('serve solo brani con un nome semplice', () => {
    expect(musicFileFromUrl(musicUrl('Lo-fi #2 è bello.mp3'))).toBe('Lo-fi #2 è bello.mp3');
    expect(musicFileFromUrl(musicUrl('..\\segreti.mp3'))).toBeNull();
    expect(musicFileFromUrl(musicUrl('note.txt'))).toBeNull();
    expect(musicFileFromUrl('prisma-media://video/abc')).toBeNull();
  });

  it('il render usa solo brani della cartella scelta', () => {
    const folder = join('C:', 'Musica');
    expect(isTrackInFolder(folder, join(folder, 'a.mp3'))).toBe(true);
    expect(isTrackInFolder(folder, join(folder, 'sotto', 'a.mp3'))).toBe(false);
    expect(isTrackInFolder(folder, join(folder, 'a.exe'))).toBe(false);
    expect(isTrackInFolder(null, join(folder, 'a.mp3'))).toBe(false);
  });

  it('elenca i brani con la durata e ricorda quelle già lette', async () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-musica-'));
    const music = join(dir, 'musica');
    mkdirSync(music);
    writeFileSync(join(music, 'b.mp3'), 'b');
    writeFileSync(join(music, 'A.wav'), 'a');
    writeFileSync(join(music, 'copertina.jpg'), 'x');
    mkdirSync(join(music, 'album.mp3'));
    let probes = 0;
    const library = createMusicLibrary({
      settingsFile: join(dir, 'musica.json'),
      ffprobe: async () => 'ffprobe',
      probe: async () => {
        probes++;
        return 90_000;
      },
    });
    expect(await library.status()).toEqual({ dir: null, tracks: [], error: null });
    const status = await library.setDir(music);
    expect(status.tracks.map((t) => t.fileName)).toEqual(['A.wav', 'b.mp3']);
    expect(status.tracks[0]).toMatchObject({ path: join(music, 'A.wav'), durationMs: 90_000 });
    await library.status();
    expect(probes).toBe(2);
    rmSync(music, { recursive: true });
    expect((await library.status()).error).toBe('Cartella non trovata');
  });
});
