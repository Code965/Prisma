import type { BrollMedia, StockItem } from '@prisma-app/shared';
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * B-roll (fase 6d): una cartella dell'utente con spezzoni e immagini (come la musica) e i file
 * scaricati da Pixabay in `userData/broll-pixabay/`. Il renderer e il render possono usare solo
 * file di questi due posti, indicati da una chiave (`cartella/<nome>`, `pixabay/<file>`).
 */

export const BROLL_VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'm4v'];
export const BROLL_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export interface BrollStatus {
  dir: string | null;
  items: BrollMedia[];
  error: string | null;
}

export function brollKind(fileName: string): 'video' | 'image' | null {
  const ext = extname(fileName).slice(1).toLowerCase();
  if (BROLL_VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (BROLL_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return null;
}

const simpleName = (name: string) =>
  Boolean(name) && !/[\\/]/.test(name) && name !== '..' && name !== '.';
const PIXABAY_FILE = /^pixabay-\d+\.(mp4|jpg|jpeg|png|webp)$/i;

/** Percorso del file da una chiave; null se la chiave non è ammessa. */
export function brollPathFromKey(key: string, dir: string | null, cacheDir: string): string | null {
  const [area, ...rest] = key.split('/');
  const name = rest.join('/');
  if (area === 'cartella' && dir && simpleName(name) && brollKind(name)) return join(dir, name);
  if (area === 'pixabay' && PIXABAY_FILE.test(name)) return join(cacheDir, name);
  return null;
}

/** Il file sta direttamente nella cartella del B-roll o nella cache di Pixabay. */
export function isBrollPathAllowed(path: string, dir: string | null, cacheDir: string): boolean {
  const folder = resolve(dirname(path)).toLowerCase();
  const allowed = [cacheDir, ...(dir ? [dir] : [])].map((d) => resolve(d).toLowerCase());
  return allowed.includes(folder) && brollKind(basename(path)) !== null;
}

/** Indirizzo per l'anteprima nel renderer. */
export function brollUrl(key: string): string {
  return `prisma-media://broll/${encodeURIComponent(key)}`;
}

export function brollKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'broll') return null;
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

/** Solo i file di Pixabay, in https. */
export function isPixabayDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'cdn.pixabay.com' || parsed.hostname === 'pixabay.com')
    );
  } catch {
    return false;
  }
}

/** Nome del file in cache: `pixabay-<id>.<estensione>`. */
export function pixabayFileName(item: StockItem): string {
  const ext = extname(new URL(item.downloadUrl).pathname).slice(1).toLowerCase();
  const allowed = item.kind === 'video' ? ['mp4'] : ['jpg', 'jpeg', 'png', 'webp'];
  return `pixabay-${item.id}.${allowed.includes(ext) ? ext : item.kind === 'video' ? 'mp4' : 'jpg'}`;
}

export function pixabayCredit(item: StockItem): string {
  return `${item.kind === 'video' ? 'Video' : 'Foto'} di ${item.user || 'un autore'} da Pixabay`;
}

interface ProbeInfo {
  width: number;
  height: number;
  durationMs: number;
}

export async function probeMedia(ffprobe: string, path: string): Promise<ProbeInfo> {
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  const output = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = output.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!video?.width || !video.height) throw new Error('Il file non ha immagini leggibili');
  return {
    width: video.width,
    height: video.height,
    durationMs: Math.round(Number(output.format?.duration ?? 0) * 1000),
  };
}

export function createBrollLibrary(options: {
  settingsFile: string;
  cacheDir: string;
  ffprobe: () => Promise<string | null>;
  probe?: (ffprobe: string, path: string) => Promise<ProbeInfo>;
  fetch?: typeof fetch;
}) {
  const probe = options.probe ?? probeMedia;
  const cache = new Map<string, ProbeInfo>();

  async function readDir(): Promise<string | null> {
    try {
      const { dir } = JSON.parse(await readFile(options.settingsFile, 'utf8')) as { dir?: unknown };
      return typeof dir === 'string' && dir ? dir : null;
    } catch {
      return null;
    }
  }

  async function requireFfprobe(): Promise<string> {
    const ffprobe = await options.ffprobe();
    if (!ffprobe) throw new Error('Serve ffprobe per leggere il B-roll');
    return ffprobe;
  }

  async function info(ffprobe: string, path: string): Promise<ProbeInfo> {
    const file = await stat(path);
    const key = `${path}|${file.size}|${file.mtimeMs}`;
    let found = cache.get(key);
    if (!found) {
      found = await probe(ffprobe, path);
      cache.set(key, found);
    }
    return found;
  }

  async function status(): Promise<BrollStatus> {
    const dir = await readDir();
    if (!dir) return { dir: null, items: [], error: null };
    let names: string[];
    try {
      names = (await readdir(dir))
        .filter((n) => brollKind(n))
        .sort((a, b) => a.localeCompare(b, 'it'));
    } catch {
      return { dir, items: [], error: 'Cartella non trovata' };
    }
    const ffprobe = await options.ffprobe();
    if (!ffprobe) return { dir, items: [], error: 'Serve ffprobe per leggere il B-roll' };
    const items: BrollMedia[] = [];
    for (const fileName of names) {
      const path = join(dir, fileName);
      try {
        const media = await info(ffprobe, path);
        items.push({
          key: `cartella/${fileName}`,
          path,
          fileName,
          kind: brollKind(fileName)!,
          width: media.width,
          height: media.height,
          durationMs: brollKind(fileName) === 'image' ? 0 : media.durationMs,
          source: 'cartella',
          credit: null,
          pageUrl: null,
        });
      } catch {
        // File illeggibile: si salta.
      }
    }
    return { dir, items, error: null };
  }

  return {
    status,
    dir: readDir,
    async setDir(dir: string | null): Promise<BrollStatus> {
      await writeFile(options.settingsFile, JSON.stringify({ dir }, null, 2), 'utf8');
      return status();
    },
    async pathOf(key: string): Promise<string | null> {
      return brollPathFromKey(key, await readDir(), options.cacheDir);
    },
    async isAllowed(path: string): Promise<boolean> {
      return isBrollPathAllowed(path, await readDir(), options.cacheDir);
    },

    /** Scarica un risultato di Pixabay nella cache (una volta sola) e lo descrive. */
    async download(item: StockItem): Promise<BrollMedia> {
      if (!isPixabayDownloadUrl(item.downloadUrl)) {
        throw new Error('Si scaricano solo file di Pixabay');
      }
      const fileName = pixabayFileName(item);
      const path = join(options.cacheDir, fileName);
      if (!existsSync(path)) {
        await mkdir(options.cacheDir, { recursive: true });
        const partial = `${path}.part`;
        const fetcher = options.fetch ?? fetch;
        const response = await fetcher(item.downloadUrl, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok || !response.body) {
          throw new Error(`Download da Pixabay non riuscito (${response.status})`);
        }
        try {
          await pipeline(
            Readable.fromWeb(response.body as WebReadableStream),
            createWriteStream(partial),
          );
          await rename(partial, path);
        } catch (error) {
          await rm(partial, { force: true });
          throw error;
        }
      }
      const media = await info(await requireFfprobe(), path);
      return {
        key: `pixabay/${fileName}`,
        path,
        fileName,
        kind: item.kind,
        width: media.width,
        height: media.height,
        durationMs: item.kind === 'image' ? 0 : media.durationMs,
        source: 'pixabay',
        credit: pixabayCredit(item),
        pageUrl: item.pageUrl,
      };
    },
  };
}

export type BrollLibrary = ReturnType<typeof createBrollLibrary>;
