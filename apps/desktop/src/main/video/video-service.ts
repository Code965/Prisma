import {
  VIDEO_TOOLS,
  shortEdit,
  type ToolsStatus,
  type VideoEdit,
  type VideoProject,
  type VideoTool,
} from '@prisma-app/shared';
import { dialog, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { CreateShortRequest } from '../ipc-contract.js';
import { probeVideo } from './ffprobe.js';
import type { LocalStore } from './store.js';
import {
  defaultEnvironment,
  readToolPaths,
  toolStatus,
  writeToolPaths,
  type ToolEnvironment,
} from './tools.js';

/** Estensioni proposte dal selettore dei file (ffprobe decide poi se il file è un video). */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];

const TOOL_FILTERS: Record<VideoTool, Electron.FileFilter[]> = {
  ffmpeg: [{ name: 'Eseguibile', extensions: ['exe'] }],
  ffprobe: [{ name: 'Eseguibile', extensions: ['exe'] }],
  whisper: [{ name: 'Eseguibile', extensions: ['exe'] }],
  whisperModel: [{ name: 'Modello whisper.cpp', extensions: ['bin'] }],
  tts: [{ name: 'sherpa-onnx-offline-tts.exe', extensions: ['exe'] }],
  ttsVoice: [{ name: 'Voce Piper (.onnx)', extensions: ['onnx'] }],
  filmcraft: [{ name: 'FilmCraft (filmcraft.exe)', extensions: ['exe'] }],
};

export function createVideoService(options: {
  userDataDir: string;
  store: LocalStore;
  env?: ToolEnvironment;
}) {
  const { store } = options;
  const toolsFile = join(options.userDataDir, 'video-tools.json');
  const env = options.env ?? defaultEnvironment(options.userDataDir);

  async function toolsStatus(): Promise<ToolsStatus> {
    const paths = await readToolPaths(toolsFile);
    return Promise.all(VIDEO_TOOLS.map((tool) => toolStatus(tool, paths[tool], env)));
  }

  async function setToolPath(tool: VideoTool, path: string | null): Promise<ToolsStatus> {
    const paths = await readToolPaths(toolsFile);
    if (path) paths[tool] = path;
    else delete paths[tool];
    await writeToolPaths(toolsFile, paths);
    return toolsStatus();
  }

  /** Percorso di uno strumento funzionante, oppure un errore che dice cosa installare. */
  async function requireTool(tool: VideoTool): Promise<string> {
    const status = (await toolsStatus()).find((s) => s.tool === tool)!;
    if (!status.path || status.error) {
      throw new Error(
        `${tool} non disponibile: installalo o indica il percorso in Impostazioni › Strumenti video`,
      );
    }
    return status.path;
  }

  return {
    toolsStatus,
    setToolPath,
    requireTool,

    async pickToolPath(window: BrowserWindow | null, tool: VideoTool): Promise<ToolsStatus | null> {
      const options = { properties: ['openFile' as const], filters: TOOL_FILTERS[tool] };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      return setToolPath(tool, result.filePaths[0]);
    },

    listProjects: (): VideoProject[] => store.listProjects(),

    /** Sceglie un video, ne legge i metadati con ffprobe e crea il progetto. */
    async importVideo(window: BrowserWindow | null): Promise<VideoProject | null> {
      const ffprobe = await requireTool('ffprobe');
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      return store.createProject(await probeVideo(ffprobe, path));
    },

    removeProject: (id: string): void => store.removeProject(id),

    /**
     * Progetto Short: stesso file e stessa trascrizione del video lungo, tagliato attorno al
     * momento scelto dall'LLM e in 9:16. Il sorgente non viene copiato.
     */
    createShort(input: CreateShortRequest): VideoProject {
      const parent = store.getProject(input.parentId);
      if (!parent) throw new Error('Progetto video non trovato');
      const durationMs = parent.source.durationMs;
      if (input.endMs > durationMs + 1000) throw new Error('Il momento va oltre la fine del video');
      const moment = { startMs: input.startMs, endMs: Math.min(input.endMs, durationMs) };
      return store.createProject(parent.source, input.title, {
        transcript: parent.transcript,
        edit: shortEdit(parent.edit, durationMs, moment),
        short: { parentId: parent.id, contentId: input.contentId, ...moment },
      });
    },

    /** Salva tagli, formato e sottotitoli scelti nell'editor. */
    saveEdit(id: string, edit: VideoEdit, now: Date = new Date()): VideoProject {
      const project = store.getProject(id);
      if (!project) throw new Error('Progetto video non trovato');
      const updated = { ...project, edit, updatedAt: now.toISOString() };
      store.updateProject(updated);
      return updated;
    },

    sourcePathOf: (id: string): string | null => store.getProject(id)?.source.path ?? null,

    getProject: (id: string): VideoProject | null => store.getProject(id),
  };
}

export type VideoService = ReturnType<typeof createVideoService>;
