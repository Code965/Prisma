import { BrowserWindow, app, shell } from 'electron';
import type { VideoJobProgress } from '@prisma-app/shared';
import { join } from 'node:path';
import { resolveDataDir } from './app-data.js';
import { SLIDE_FONT_FILES } from './export/font-files.js';
import { embeddedFontFaceCss } from './export/fonts.js';
import { SPLASH_BACKGROUND, SPLASH_MIN_MS, SPLASH_SIZE, splashDataUrl } from './splash.js';
import { registerUpdates } from './updates.js';
import { startCore, type Core } from './core.js';
import { setupBackground, startedHidden } from './background.js';
import { captureImage, captureJpeg } from './export/carousel-export.js';
import { handleAppAssets } from './app-assets.js';
import { createRecordingService } from './recording.js';
import { registerIpcHandlers, setCore, slideFontFaceCss } from './ipc.js';
import { startupMode } from './settings.js';
import { handleMediaProtocol, registerMediaScheme } from './video/media-protocol.js';
import { LocalStore } from './video/store.js';
import { VIDEO_PROGRESS_EVENT } from './ipc-contract.js';
import { pickTrack } from '@prisma-app/shared';
import { probeVideo } from './video/ffprobe.js';
import { createFilmcraftService } from './video/filmcraft/service.js';
import { createIdeaVideoService } from './video/idea-video.js';
import { readAnsiCodePage } from './video/tts.js';
import { createMusicLibrary } from './video/music.js';
import { createBrollLibrary } from './video/broll.js';
import { runProcess } from './video/process.js';
import { createRenderService } from './video/render.js';
import { createTranscriptionService } from './video/transcription.js';
import { createVideoService } from './video/video-service.js';

const isDev = !app.isPackaged;

// Nome e cartella dei dati, prima di qualunque uso di `userData` (anche da parte di Electron).
app.setName('Prisma');
// PRISMA_DATA_DIR: cartella dei dati a parte (prove e dimostrazioni con un database nuovo).
const customDataDir = process.env['PRISMA_DATA_DIR'];
const dataDir = customDataDir
  ? { userData: customDataDir, outcome: 'nuova' as const, error: undefined }
  : resolveDataDir(app.getPath('appData'));
app.setPath('userData', dataDir.userData);
// Una sola Prisma per cartella dei dati: un secondo avvio riapre la finestra di quella attiva.
if (!app.requestSingleInstanceLock()) app.exit(0);
if (dataDir.outcome === 'spostata') console.info(`Dati spostati in ${dataDir.userData}`);
if (dataDir.outcome === 'unita')
  console.info(`Dati della vecchia cartella uniti in ${dataDir.userData}`);
if (dataDir.outcome === 'nuova' && dataDir.error) console.warn(dataDir.error);
if (dataDir.outcome === 'vecchia') {
  console.warn(`Vecchia cartella dei dati in uso (${dataDir.error}): chiudi l'app e riaprila`);
}
const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
/** Nell'app installata l'icona è quella dell'eseguibile; in sviluppo si prende da `build/`. */
const devIcon = isDev ? join(import.meta.dirname, '../../build/icon.png') : undefined;

/** Intro mentre la finestra principale si carica (vedi `splash.ts`). */
async function showSplash(): Promise<BrowserWindow> {
  const splash = new BrowserWindow({
    ...SPLASH_SIZE,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    skipTaskbar: false,
    title: 'Prisma',
    backgroundColor: SPLASH_BACKGROUND,
    ...(devIcon ? { icon: devIcon } : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splash.webContents.on('will-navigate', (event) => event.preventDefault());
  splash.once('ready-to-show', () => splash.show());
  // Solo i pesi usati nell'intro: Inter 700 per il nome, 400 per il resto, JetBrains Mono.
  const fonts = SLIDE_FONT_FILES.filter(
    (font) => font.family !== 'Inter' || font.weight === 400 || font.weight === 700,
  );
  const fontFaceCss = await embeddedFontFaceCss(fonts).catch(() => '');
  await splash.loadURL(splashDataUrl({ version: app.getVersion(), fontFaceCss }));
  return splash;
}

/** `onReady`: cosa fare quando il contenuto è pronto (di norma mostrare la finestra). */
function createMainWindow(
  onReady: (window: BrowserWindow) => void = (window) => window.show(),
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Prisma',
    backgroundColor: '#F5F6F8',
    autoHideMenuBar: true,
    ...(devIcon ? { icon: devIcon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => onReady(window));

  // I link esterni si aprono nel browser di sistema; la finestra non naviga mai fuori dall'app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!rendererUrl || !url.startsWith(rendererUrl)) event.preventDefault();
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer terminato: ${details.reason} (codice ${details.exitCode})`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Caricamento fallito (${code} ${description}): ${url}`);
  });

  if (isDev && rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));

  return window;
}

// Il protocollo dei video va dichiarato prima che l'app sia pronta.
registerMediaScheme();

void app.whenReady().then(async () => {
  const startedAt = Date.now();
  // Avvio con Windows: niente intro e niente finestra, solo l'icona nell'area di notifica.
  const hidden = startedHidden();
  const splash = hidden
    ? null
    : await showSplash().catch((error: unknown) => {
        console.error('Intro non disponibile:', error);
        return null;
      });
  const userDataDir = app.getPath('userData');
  // Dati sul computer (predefinito): il server di Prisma parte qui dentro, mentre c'è l'intro.
  let core: Promise<Core> | null = null;
  if (startupMode() === 'locale') {
    core = startCore(userDataDir);
    core.catch((error: unknown) => console.error('Avvio dei dati non riuscito:', error));
    app.once('before-quit', () => void core?.then((started) => started.stop()).catch(() => {}));
  }
  setCore(core);
  const store = new LocalStore(join(userDataDir, 'prisma.db'));
  const video = createVideoService({ userDataDir, store });
  const music = createMusicLibrary({
    settingsFile: join(userDataDir, 'musica.json'),
    ffprobe: () => video.requireTool('ffprobe').catch(() => null),
  });
  const broll = createBrollLibrary({
    settingsFile: join(userDataDir, 'broll.json'),
    cacheDir: join(userDataDir, 'broll-pixabay'),
    ffprobe: () => video.requireTool('ffprobe').catch(() => null),
  });
  handleAppAssets(join(import.meta.dirname, '../renderer/assets'));
  handleMediaProtocol(
    video.sourcePathOf,
    async (fileName) => {
      const dir = await music.dir();
      return dir ? join(dir, fileName) : null;
    },
    (key) => broll.pathOf(key),
    (id) => store.getProject(id)?.screen?.path ?? null,
  );
  // L'avanzamento va a tutte le finestre: ognuna mostra quello dei suoi progetti.
  const emitProgress = (progress: VideoJobProgress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(VIDEO_PROGRESS_EVENT, progress);
    }
  };
  const transcription = createTranscriptionService({
    store,
    requireTool: video.requireTool,
    workRoot: join(userDataDir, 'video-lavoro'),
    run: runProcess,
    emit: emitProgress,
  });
  const render = createRenderService({
    store,
    requireTool: video.requireTool,
    workRoot: join(userDataDir, 'video-lavoro'),
    // Stessa cartella degli export dei caroselli: da lì i file si possono caricare su R2.
    exportsRoot: join(userDataDir, 'esportazioni'),
    run: runProcess,
    emit: emitProgress,
    measureDurationMs: async (path) =>
      (await probeVideo(await video.requireTool('ffprobe'), path)).durationMs,
    musicDir: () => music.dir(),
    captureCard: (html, width, height) => captureImage(html, { width, height, format: 'png' }),
    fontFaceCss: slideFontFaceCss,
    brollAllowed: (path) => broll.isAllowed(path),
  });
  const filmcraft = createFilmcraftService({
    store,
    requireTool: video.requireTool,
    workRoot: join(userDataDir, 'filmcraft'),
    exportsRoot: join(userDataDir, 'esportazioni'),
    run: runProcess,
    probe: probeVideo,
    emit: emitProgress,
  });
  const ideaVideo = createIdeaVideoService({
    store,
    toolsStatus: video.toolsStatus,
    requireTool: video.requireTool,
    // I video creati restano qui: sono il sorgente del progetto.
    videosRoot: join(userDataDir, 'video-creati'),
    run: runProcess,
    emit: emitProgress,
    captureSlide: captureJpeg,
    fontFaceCss: slideFontFaceCss,
    probe: probeVideo,
    transcribe: (projectId) => transcription.transcribe(projectId, 'it'),
    codePage: readAnsiCodePage,
    // Il video ha già una musica, da cambiare o togliere nell'editor.
    pickMusic: async () => pickTrack((await music.status()).tracks, Math.random()),
  });
  const recording = createRecordingService({
    store,
    rootDir: join(userDataDir, 'registrazioni'),
    requireTool: video.requireTool,
    run: runProcess,
    probe: probeVideo,
    emit: emitProgress,
  });
  // Permessi delle pagine (solo webcam, microfono, schermo, appunti) e schermo per getDisplayMedia.
  recording.attach();
  registerIpcHandlers(video, transcription, render, filmcraft, ideaVideo, music, broll, recording);
  const updates = registerUpdates();

  // L'intro resta almeno SPLASH_MIN_MS, poi lascia il posto alla finestra principale.
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (!hidden && !main.isDestroyed()) main.show();
    if (splash && !splash.isDestroyed()) splash.destroy();
    updates.checkOnStartup();
  };
  const main = createMainWindow(() =>
    setTimeout(reveal, Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt))),
  );
  // Se il caricamento si blocca, l'intro non resta aperta per sempre.
  setTimeout(reveal, 20_000);
  setupBackground({
    userDataDir,
    enabled: startupMode() === 'locale',
    getWindow: () => main,
    ...(devIcon ? { icon: devIcon } : {}),
  }).attach(main);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
