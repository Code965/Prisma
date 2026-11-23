import type { ToolStatus, VideoTool } from '@prisma-app/shared';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Percorsi impostati a mano nelle Impostazioni (file `video-tools.json` nella cartella dati). */
export type ToolPaths = Partial<Record<VideoTool, string>>;

/** Nomi degli eseguibili cercati nel PATH (whisper.cpp: `whisper-cli` nelle versioni recenti). */
const EXECUTABLES: Record<Exclude<VideoTool, 'whisperModel'>, string[]> = {
  ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
  ffprobe: ['ffprobe.exe', 'ffprobe'],
  whisper: ['whisper-cli.exe', 'whisper-cli', 'whisper.exe'],
  filmcraft: ['filmcraft.exe', 'filmcraft'],
};

export interface ToolEnvironment {
  /** Cartelle del PATH più quelle note (es. i collegamenti di winget, assenti dal PATH di un'app già aperta). */
  searchDirs: string[];
  /** Dove cercare i modelli `ggml-*.bin` di whisper.cpp. */
  modelDirs: string[];
  exists: (path: string) => boolean;
  list: (dir: string) => string[];
  sizeOf: (path: string) => number;
  /** Prima riga dell'output del programma con l'opzione indicata. */
  probe: (path: string, args: string[]) => Promise<string>;
}

export function defaultEnvironment(userDataDir: string): ToolEnvironment {
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  // FilmCraft: installazione dal launcher di ArtCraft (Programmi) o dall'MSI per utente.
  const known = [
    ...(local ? [join(local, 'Microsoft', 'WinGet', 'Links')] : []),
    ...(programFiles ? [join(programFiles, 'ArtCraft', 'FilmCraft')] : []),
    ...(local ? [join(local, 'Programs', 'ArtCraft', 'FilmCraft')] : []),
  ];
  return {
    searchDirs: [...pathDirs, ...known],
    modelDirs: [join(userDataDir, 'whisper-models')],
    exists: (path) => existsSync(path),
    list: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    sizeOf: (path) => statSync(path).size,
    probe: async (path, args) => {
      // whisper.cpp con -h esce con codice diverso da 0: conta solo che parta e risponda.
      const { stdout, stderr } = await run(path, args, {
        timeout: 10_000,
        windowsHide: true,
      }).catch((error: { stdout?: string; stderr?: string; code?: unknown }) => {
        if (typeof error.code === 'number' && (error.stdout || error.stderr)) {
          return { stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
        }
        throw error;
      });
      return `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0] ?? '';
    },
  };
}

function findExecutable(env: ToolEnvironment, names: string[]): string | null {
  for (const dir of env.searchDirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (env.exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Il modello più grande tra quelli presenti: di solito il più preciso che si è scelto di scaricare. */
function findModel(env: ToolEnvironment): string | null {
  const models = env.modelDirs.flatMap((dir) =>
    env
      .list(dir)
      .filter((file) => /^ggml-.+\.bin$/i.test(file))
      .map((file) => join(dir, file)),
  );
  models.sort((a, b) => env.sizeOf(b) - env.sizeOf(a));
  return models[0] ?? null;
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const PROBE_ARGS: Record<Exclude<VideoTool, 'whisperModel'>, string[]> = {
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  whisper: ['-h'],
  filmcraft: ['--version'],
};

/** Stato di uno strumento: percorso impostato se c'è, altrimenti rilevamento automatico. */
export async function toolStatus(
  tool: VideoTool,
  configured: string | undefined,
  env: ToolEnvironment,
): Promise<ToolStatus> {
  const absent: ToolStatus = { tool, path: null, source: 'assente', detail: null, error: null };
  if (tool === 'whisperModel') {
    const path = configured ?? findModel(env);
    if (!path) return absent;
    if (!env.exists(path)) {
      return { ...absent, path, source: 'impostato', error: 'File non trovato' };
    }
    return {
      tool,
      path,
      source: configured ? 'impostato' : 'rilevato',
      detail: formatMegabytes(env.sizeOf(path)),
      error: null,
    };
  }

  const path = configured ?? findExecutable(env, EXECUTABLES[tool]);
  if (!path) return absent;
  const source = configured ? 'impostato' : 'rilevato';
  if (!env.exists(path)) return { tool, path, source, detail: null, error: 'File non trovato' };
  // FilmCraft: l'app grafica con --version non esce; si prova la CLI che sta accanto.
  const probed = tool === 'filmcraft' ? join(dirname(path), 'filmcraft-cli.exe') : path;
  if (!env.exists(probed)) {
    return { tool, path, source, detail: null, error: 'Manca filmcraft-cli.exe accanto all’app' };
  }
  try {
    const detail = await env.probe(probed, PROBE_ARGS[tool]);
    return { tool, path, source, detail: detail.slice(0, 120) || null, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { tool, path, source, detail: null, error: `Non si avvia: ${message.slice(0, 160)}` };
  }
}

export async function readToolPaths(file: string): Promise<ToolPaths> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ToolPaths;
  } catch {
    return {};
  }
}

export async function writeToolPaths(file: string, paths: ToolPaths): Promise<void> {
  await writeFile(file, JSON.stringify(paths, null, 2), 'utf8');
}
