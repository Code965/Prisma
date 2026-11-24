import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApiRequest,
  BackgroundSettings,
  ApiResponse,
  ConnectionSettingsInput,
  ConnectionSettingsView,
  CreateShortRequest,
  FilmcraftOpen,
  GenerateVideoRequest,
  ExportCarouselRequest,
  ExportCarouselResult,
  SetToolPath,
  UploadFileRequest,
} from '../main/ipc-contract.js';
import type { UpdateState } from '../main/update-state.js';
import type {
  ToolsStatus,
  TranscriptLanguage,
  VideoEdit,
  VideoJobProgress,
  VideoProject,
  VideoTool,
} from '@prisma-app/shared';

// Nomi dei canali duplicati qui: il preload in sandbox non può importare moduli a runtime.
const CHANNELS = {
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  apiRequest: 'api:request',
  openExternal: 'external:open',
  exportCarousel: 'carousel:export',
  showExport: 'export:show',
  uploadFile: 'upload:file',
  toolsStatus: 'tools:status',
  setToolPath: 'tools:set',
  pickToolPath: 'tools:pick',
  listVideos: 'video:list',
  importVideo: 'video:import',
  removeVideo: 'video:remove',
  transcribeVideo: 'video:transcribe',
  cancelVideoJob: 'video:cancel',
  saveVideoEdit: 'video:save-edit',
  renderVideo: 'video:render',
  renderStatus: 'video:render-status',
  createShort: 'video:create-short',
  generateVideo: 'video:generate',
  filmcraftStatus: 'filmcraft:status',
  filmcraftOpen: 'filmcraft:open',
  filmcraftExport: 'filmcraft:export',
  filmcraftUseReturn: 'filmcraft:use-return',
  videoProgress: 'video:progress',
  updateState: 'updates:state',
  updateCheck: 'updates:check',
  updateDismiss: 'updates:dismiss',
  updateSkip: 'updates:skip',
  updateInstall: 'updates:install',
  updateChanged: 'updates:changed',
  restartApp: 'app:restart',
  backgroundGet: 'background:get',
  backgroundSet: 'background:set',
} as const;

/**
 * API esposta al renderer come `window.prisma`. Ogni funzione è una porta verso il main:
 * il main valida gli argomenti e il renderer non riceve mai il token API.
 */
const api = {
  platform: process.platform,
  settings: {
    get: (): Promise<ConnectionSettingsView> => ipcRenderer.invoke(CHANNELS.getSettings),
    save: (input: ConnectionSettingsInput): Promise<ConnectionSettingsView> =>
      ipcRenderer.invoke(CHANNELS.saveSettings, input),
  },
  request: (request: ApiRequest): Promise<ApiResponse> =>
    ipcRenderer.invoke(CHANNELS.apiRequest, request),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CHANNELS.openExternal, url),
  background: {
    get: (): Promise<BackgroundSettings> => ipcRenderer.invoke(CHANNELS.backgroundGet),
    set: (
      input: Partial<Pick<BackgroundSettings, 'keepRunning' | 'openAtLogin'>>,
    ): Promise<BackgroundSettings> => ipcRenderer.invoke(CHANNELS.backgroundSet, input),
  },
  /** Riavvia Prisma (cambio tra dati sul computer e server remoto). */
  restart: (): Promise<void> => ipcRenderer.invoke(CHANNELS.restartApp),
  exportCarousel: (request: ExportCarouselRequest): Promise<ExportCarouselResult> =>
    ipcRenderer.invoke(CHANNELS.exportCarousel, request),
  showExport: (path: string): Promise<void> => ipcRenderer.invoke(CHANNELS.showExport, path),
  uploadFile: (request: UploadFileRequest): Promise<{ sizeBytes: number }> =>
    ipcRenderer.invoke(CHANNELS.uploadFile, request),
  tools: {
    status: (): Promise<ToolsStatus> => ipcRenderer.invoke(CHANNELS.toolsStatus),
    setPath: (input: SetToolPath): Promise<ToolsStatus> =>
      ipcRenderer.invoke(CHANNELS.setToolPath, input),
    /** null se l'utente annulla la scelta del file. */
    pickPath: (tool: VideoTool): Promise<ToolsStatus | null> =>
      ipcRenderer.invoke(CHANNELS.pickToolPath, tool),
  },
  filmcraft: {
    status: (projectId: string): Promise<{ connected: boolean; stale: boolean }> =>
      ipcRenderer.invoke(CHANNELS.filmcraftStatus, projectId),
    open: (input: FilmcraftOpen): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.filmcraftOpen, input),
    /** Esporta da FilmCraft e registra il file rientrato (avanzamento con `video.onProgress`). */
    exportReturn: (projectId: string): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.filmcraftExport, projectId),
    useReturn: (projectId: string): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.filmcraftUseReturn, projectId),
  },
  updates: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke(CHANNELS.updateState),
    /** Verifica chiesta a mano: a fine controllo la finestra si apre comunque. */
    check: (): Promise<UpdateState> => ipcRenderer.invoke(CHANNELS.updateCheck),
    dismiss: (): Promise<void> => ipcRenderer.invoke(CHANNELS.updateDismiss),
    skip: (): Promise<void> => ipcRenderer.invoke(CHANNELS.updateSkip),
    install: (): Promise<void> => ipcRenderer.invoke(CHANNELS.updateInstall),
    onChange: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on(CHANNELS.updateChanged, handler);
      return () => ipcRenderer.removeListener(CHANNELS.updateChanged, handler);
    },
  },
  video: {
    list: (): Promise<VideoProject[]> => ipcRenderer.invoke(CHANNELS.listVideos),
    /** null se l'utente annulla la scelta del file. */
    import: (): Promise<VideoProject | null> => ipcRenderer.invoke(CHANNELS.importVideo),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(CHANNELS.removeVideo, id),
    transcribe: (projectId: string, language: TranscriptLanguage): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.transcribeVideo, { projectId, language }),
    cancel: (projectId: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.cancelVideoJob, projectId),
    saveEdit: (projectId: string, edit: VideoEdit): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.saveVideoEdit, { projectId, edit }),
    render: (projectId: string): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.renderVideo, projectId),
    renderStatus: (projectId: string): Promise<{ upToDate: boolean }> =>
      ipcRenderer.invoke(CHANNELS.renderStatus, projectId),
    createShort: (input: CreateShortRequest): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.createShort, input),
    /** «Crea video dall'idea»: voce, slide e montaggio; annullabile con `cancel(jobId)`. */
    generate: (input: GenerateVideoRequest): Promise<VideoProject> =>
      ipcRenderer.invoke(CHANNELS.generateVideo, input),
    /** Avanzamento dei lavori sui video; restituisce la funzione per smettere di ascoltare. */
    onProgress: (listener: (progress: VideoJobProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: VideoJobProgress) =>
        listener(progress);
      ipcRenderer.on(CHANNELS.videoProgress, handler);
      return () => ipcRenderer.removeListener(CHANNELS.videoProgress, handler);
    },
  },
};

export type PrismaApi = typeof api;

contextBridge.exposeInMainWorld('prisma', api);
