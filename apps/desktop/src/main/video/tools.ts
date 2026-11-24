import type { ToolStatus, VideoTool } from '@prisma-app/shared';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Percorsi impostati a mano nelle Impostazioni (file `video-tools.json` nella cartella dati). */
export type ToolPaths = Partial<Record<VideoTool, string>>;

/** Nomi degli eseguibili cercati nel PATH (whisper.cpp: `whisper-cli` nelle versioni recenti). */
const EXECUTABLES: Record<Exclude<VideoTool, 'whisperModel' | 'ttsVoice'>, string[]> = {
  ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
  ffprobe: ['ffprobe.exe', 'ffprobe'],
  whisper: ['whisper-cli.exe', 'whisper-cli', 'whisper.exe'],
  tts: ['sherpa-onnx-offline-tts.exe', 'sherpa-onnx-offline-tts'],
  filmcraft: ['filmcraft.exe', 'filmcraft'],
};

export interface ToolEnvironment {
  /** Cartelle del PATH più quelle note (es. i collegamenti di winget, assenti dal PATH di un'app già aperta). */
  searchDirs: string[];
  /** Dove cercare i modelli `ggml-*.bin` di whisper.cpp. */
  modelDirs: string[];
  /** Dove cercare le voci Piper per sherpa-onnx: una sottocartella per voce. */
  voiceDirs: string[];
  exists: (path: string) => boolean;
  list: (dir: string) => string[];
  sizeOf: (path: string) => number;
  /** Prima riga dell'output del programma con l'opzione indicata. */
  probe: (path: string, args: string[]) => Promise<string>;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function defaultEnvironment(userDataDir: string): ToolEnvironment {
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  // FilmCraft: installazione dal launcher di ArtCraft (Programmi) o dall'MSI per utente.
  // sherpa-onnx: zip della release estratto in %LOCALAPPDATA%\Programs\sherpa-onnx\<versione>.
  const sherpaRoot = local ? join(local, 'Programs', 'sherpa-onnx') : null;
  const sherpaBins = sherpaRoot
    ? listDir(sherpaRoot)
        .sort()
        .reverse()
        .map((dir) => join(sherpaRoot, dir, 'bin'))
    : [];
  const known = [
    ...(local ? [join(local, 'Microsoft', 'WinGet', 'Links')] : []),
    ...sherpaBins,
    ...(programFiles ? [join(programFiles, 'ArtCraft', 'FilmCraft')] : []),
    ...(local ? [join(local, 'Programs', 'ArtCraft', 'FilmCraft')] : []),
  ];
  return {
    searchDirs: [...pathDirs, ...known],
    modelDirs: [join(userDataDir, 'whisper-models')],
    voiceDirs: [join(userDataDir, 'voci')],
    exists: (path) => existsSync(path),
    list: listDir,
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

/** Prima voce trovata: `<cartella voci>/<voce>/<nome>.onnx` con `tokens.txt` accanto. */
function findVoice(env: ToolEnvironment): string | null {
  for (const root of env.voiceDirs) {
    for (const dir of env.list(root).sort()) {
      const onnx = env.list(join(root, dir)).find((file) => /\.onnx$/i.test(file));
      if (onnx && env.exists(join(root, dir, 'tokens.txt'))) return join(root, dir, onnx);
    }
  }
  return null;
}

/** Stato di una voce Piper: il file `.onnx`, i token e i dati di espeak-ng accanto. */
function voiceStatus(configured: string | undefined, env: ToolEnvironment): ToolStatus {
  const absent: ToolStatus = {
    tool: 'ttsVoice',
    path: null,
    source: 'assente',
    detail: null,
    error: null,
  };
  const path = configured ?? findVoice(env);
  if (!path) return absent;
  const source = configured ? 'impostato' : 'rilevato';
  const dir = dirname(path);
  const missing = !env.exists(path)
    ? 'File non trovato'
    : !env.exists(join(dir, 'tokens.txt'))
      ? 'Manca tokens.txt accanto alla voce'
      : !env.exists(join(dir, 'espeak-ng-data'))
        ? 'Manca la cartella espeak-ng-data accanto alla voce'
        : null;
  return {
    tool: 'ttsVoice',
    path,
    source,
    detail: missing ? null : basename(path).replace(/\.onnx$/i, ''),
    error: missing,
  };
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const PROBE_ARGS: Record<Exclude<VideoTool, 'whisperModel' | 'ttsVoice'>, string[]> = {
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  whisper: ['-h'],
  tts: ['--help'],
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

  if (tool === 'ttsVoice') return voiceStatus(configured, env);

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
    const probe = await env.probe(probed, PROBE_ARGS[tool]);
    // sherpa-onnx non stampa la versione: la si legge dal nome della cartella della release.
    const detail =
      tool === 'tts' ? (/sherpa-onnx-(v[\d.]+)/i.exec(path)?.[1] ?? 'sherpa-onnx') : probe;
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
