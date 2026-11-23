import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { join, relative, isAbsolute } from 'node:path';
import { exportCarousel } from './export/carousel-export.js';
import { SLIDE_FONT_FILES } from './export/font-files.js';
import { embeddedFontFaceCss } from './export/fonts.js';
import { isR2UploadUrl, uploadFile } from './export/upload.js';
import type { FilmcraftService } from './video/filmcraft/service.js';
import type { RenderService } from './video/render.js';
import type { TranscriptionService } from './video/transcription.js';
import type { VideoService } from './video/video-service.js';
import {
  ApiRequestSchema,
  CreateShortRequestSchema,
  FilmcraftOpenSchema,
  ExportCarouselRequestSchema,
  SaveVideoEditSchema,
  SetToolPathSchema,
  TranscribeRequestSchema,
  ShowExportSchema,
  UploadFileRequestSchema,
  VideoProjectIdSchema,
  VideoToolSchema,
  ConnectionSettingsSchema,
  ExternalUrlSchema,
  IPC,
  type ApiRequest,
  type ApiResponse,
} from './ipc-contract.js';
import type { Core } from './core.js';
import { getConnection, getSettingsView, saveSettings, startupMode } from './settings.js';

const REQUEST_TIMEOUT_MS = 180_000; // la generazione con l'LLM può richiedere tempo

/**
 * Server dentro l'app (modalità `locale`): avviato all'apertura in `index.ts`. Null se i dati
 * stanno su un server remoto.
 */
let core: Promise<Core> | null = null;

export function setCore(started: Promise<Core> | null): void {
  core = started;
}

/** Richiesta dell'interfaccia: al server dentro l'app o a quello remoto. */
async function forwardToServer(input: unknown): Promise<ApiResponse> {
  const request = ApiRequestSchema.parse(input);
  if (startupMode() === 'locale') {
    if (!core) {
      return { status: 0, body: { error: 'non_avviato', message: 'Prisma si sta avviando…' } };
    }
    try {
      return await (await core).request(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        status: 0,
        body: { error: 'avvio_non_riuscito', message: `Avvio dei dati non riuscito: ${detail}` },
      };
    }
  }
  return forwardToRemote(request);
}

/** Inoltra una richiesta al server remoto aggiungendo il token: il renderer non lo vede mai. */
async function forwardToRemote(request: ApiRequest): Promise<ApiResponse> {
  const { serverUrl, apiToken } = getConnection();
  if (!apiToken) {
    return {
      status: 0,
      body: {
        error: 'non_configurato',
        message: 'Token API mancante: impostalo nelle Impostazioni',
      },
    };
  }

  try {
    const response = await fetch(`${serverUrl}${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // risposta non JSON: si restituisce il testo così com'è
    }
    return { status: response.status, body };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: 0,
      body: { error: 'server_non_raggiungibile', message: `Server non raggiungibile: ${detail}` },
    };
  }
}

/** Cartella degli export nella cartella dati dell'app. */
function exportsRoot(): string {
  return join(app.getPath('userData'), 'esportazioni');
}

let fontFaceCss: Promise<string> | null = null;

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function registerIpcHandlers(
  video: VideoService,
  transcription: TranscriptionService,
  render: RenderService,
  filmcraft: FilmcraftService,
): void {
  ipcMain.handle(IPC.getSettings, () => getSettingsView());
  ipcMain.handle(IPC.saveSettings, (_event, input: unknown) =>
    saveSettings(ConnectionSettingsSchema.parse(input)),
  );
  ipcMain.handle(IPC.apiRequest, (_event, input: unknown) => forwardToServer(input));
  // Dopo il cambio tra dati sul computer e server remoto.
  ipcMain.handle(IPC.restartApp, () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle(IPC.openExternal, async (_event, url: unknown) => {
    await shell.openExternal(ExternalUrlSchema.parse(url));
  });
  ipcMain.handle(IPC.exportCarousel, async (_event, input: unknown) => {
    const request = ExportCarouselRequestSchema.parse(input);
    fontFaceCss ??= embeddedFontFaceCss(SLIDE_FONT_FILES);
    return exportCarousel(request, { rootDir: exportsRoot(), fontFaceCss: await fontFaceCss });
  });
  ipcMain.handle(IPC.uploadFile, (_event, input: unknown) => {
    const request = UploadFileRequestSchema.parse(input);
    if (!isInside(exportsRoot(), request.localPath)) {
      throw new Error('Si caricano solo file della cartella degli export');
    }
    if (!isR2UploadUrl(request.url)) throw new Error('Indirizzo di caricamento non di R2');
    return uploadFile(request);
  });
  ipcMain.handle(IPC.toolsStatus, () => video.toolsStatus());
  ipcMain.handle(IPC.setToolPath, (_event, input: unknown) => {
    const { tool, path } = SetToolPathSchema.parse(input);
    return video.setToolPath(tool, path);
  });
  ipcMain.handle(IPC.pickToolPath, (event, input: unknown) =>
    video.pickToolPath(BrowserWindow.fromWebContents(event.sender), VideoToolSchema.parse(input)),
  );
  ipcMain.handle(IPC.listVideos, () => video.listProjects());
  ipcMain.handle(IPC.importVideo, (event) =>
    video.importVideo(BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle(IPC.removeVideo, (_event, input: unknown) => {
    const id = VideoProjectIdSchema.parse(input);
    transcription.cancel(id);
    video.removeProject(id);
  });
  ipcMain.handle(IPC.createShort, (_event, input: unknown) =>
    video.createShort(CreateShortRequestSchema.parse(input)),
  );
  ipcMain.handle(IPC.transcribeVideo, (_event, input: unknown) => {
    const { projectId, language } = TranscribeRequestSchema.parse(input);
    return transcription.transcribe(projectId, language);
  });
  ipcMain.handle(IPC.saveVideoEdit, (_event, input: unknown) => {
    const { projectId, edit } = SaveVideoEditSchema.parse(input);
    return video.saveEdit(projectId, edit);
  });
  ipcMain.handle(IPC.cancelVideoJob, (_event, input: unknown) => {
    const id = VideoProjectIdSchema.parse(input);
    transcription.cancel(id);
    render.cancel(id);
    filmcraft.cancel(id);
  });
  ipcMain.handle(IPC.filmcraftStatus, (_event, input: unknown) =>
    filmcraft.status(VideoProjectIdSchema.parse(input)),
  );
  ipcMain.handle(IPC.filmcraftOpen, (_event, input: unknown) => {
    const { projectId, rebuild } = FilmcraftOpenSchema.parse(input);
    return filmcraft.open(projectId, rebuild);
  });
  ipcMain.handle(IPC.filmcraftExport, (_event, input: unknown) =>
    filmcraft.exportReturn(VideoProjectIdSchema.parse(input)),
  );
  ipcMain.handle(IPC.filmcraftUseReturn, (_event, input: unknown) =>
    filmcraft.useReturn(VideoProjectIdSchema.parse(input)),
  );
  ipcMain.handle(IPC.renderVideo, (_event, input: unknown) =>
    render.render(VideoProjectIdSchema.parse(input)),
  );
  ipcMain.handle(IPC.renderStatus, (_event, input: unknown) => {
    const project = video.getProject(VideoProjectIdSchema.parse(input));
    return { upToDate: project ? render.isUpToDate(project) : false };
  });
  ipcMain.handle(IPC.showExport, (_event, input: unknown) => {
    const path = ShowExportSchema.parse(input);
    if (!isInside(exportsRoot(), path))
      throw new Error('Percorso fuori dalla cartella degli export');
    shell.showItemInFolder(path);
  });
}
