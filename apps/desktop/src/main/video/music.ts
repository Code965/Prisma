import { MUSIC_EXTENSIONS, type MusicTrack } from '@prisma-app/shared';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Cartella della musica (fase 6b): l'utente sceglie una cartella con i suoi brani, Prisma li
 * elenca senza copiarli. Si leggono solo i file direttamente nella cartella; il renderer può
 * riprodurre e il render può usare solo quelli (`isTrackInFolder`).
 */

export interface MusicStatus {
  dir: string | null;
  tracks: MusicTrack[];
  error: string | null;
}

export function isMusicFile(fileName: string): boolean {
  const ext = extname(fileName).slice(1).toLowerCase();
  return (MUSIC_EXTENSIONS as readonly string[]).includes(ext);
}

/** Il brano sta direttamente nella cartella della musica ed è un file audio ammesso. */
export function isTrackInFolder(dir: string | null, path: string): boolean {
  if (!dir) return false;
  return (
    resolve(dirname(path)).toLowerCase() === resolve(dir).toLowerCase() &&
    isMusicFile(basename(path))
  );
}

/** Indirizzo per l'anteprima: `prisma-media://musica/<nome del file>`. */
export function musicUrl(fileName: string): string {
  return `prisma-media://musica/${encodeURIComponent(fileName)}`;
}

/** Nome del file da `prisma-media://musica/<nome>`; null se non è un nome semplice. */
export function musicFileFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'musica') return null;
    const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!name || /[\\/]/.test(name) || name === '.' || name === '..') return null;
    return isMusicFile(name) ? name : null;
  } catch {
    return null;
  }
}

export async function readMusicDir(file: string): Promise<string | null> {
  try {
    const { dir } = JSON.parse(await readFile(file, 'utf8')) as { dir?: unknown };
    return typeof dir === 'string' && dir ? dir : null;
  } catch {
    return null;
  }
}

export async function writeMusicDir(file: string, dir: string | null): Promise<void> {
  await writeFile(file, JSON.stringify({ dir }, null, 2), 'utf8');
}

export async function probeDurationMs(ffprobe: string, path: string): Promise<number> {
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
    { timeout: 30_000, windowsHide: true },
  );
  return Math.round(Number(stdout.trim()) * 1000);
}

/** Brani della cartella in ordine alfabetico, con la durata (in cache finché il file non cambia). */
export function createMusicLibrary(options: {
  settingsFile: string;
  ffprobe: () => Promise<string | null>;
  probe?: (ffprobe: string, path: string) => Promise<number>;
}) {
  const probe = options.probe ?? probeDurationMs;
  const cache = new Map<string, number>();

  async function status(): Promise<MusicStatus> {
    const dir = await readMusicDir(options.settingsFile);
    if (!dir) return { dir: null, tracks: [], error: null };
    let names: string[];
    try {
      names = (await readdir(dir)).filter(isMusicFile).sort((a, b) => a.localeCompare(b, 'it'));
    } catch {
      return { dir, tracks: [], error: 'Cartella non trovata' };
    }
    const ffprobe = await options.ffprobe();
    if (!ffprobe) return { dir, tracks: [], error: 'Serve ffprobe per leggere i brani' };
    const tracks: MusicTrack[] = [];
    for (const fileName of names) {
      const path = join(dir, fileName);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        const key = `${path}|${info.size}|${info.mtimeMs}`;
        let durationMs = cache.get(key);
        if (durationMs === undefined) {
          durationMs = await probe(ffprobe, path);
          cache.set(key, durationMs);
        }
        if (durationMs > 0) tracks.push({ path, fileName, durationMs });
      } catch {
        // File illeggibile: si salta, gli altri restano.
      }
    }
    return { dir, tracks, error: null };
  }

  return {
    status,
    async setDir(dir: string | null): Promise<MusicStatus> {
      await writeMusicDir(options.settingsFile, dir);
      return status();
    },
    dir: () => readMusicDir(options.settingsFile),
  };
}

export type MusicLibrary = ReturnType<typeof createMusicLibrary>;
