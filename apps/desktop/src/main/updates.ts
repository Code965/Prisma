import { BrowserWindow, app, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IPC, UPDATE_STATE_EVENT } from './ipc-contract.js';
import {
  releaseNotesText,
  shouldPrompt,
  updateErrorMessage,
  type UpdateState,
} from './update-state.js';

/**
 * Aggiornamenti dalle release di GitHub (repository pubblico `Code965/Prisma`, scritto
 * da electron-builder in `app-update.yml`). All'avvio, qualche secondo dopo la finestra, si cerca
 * una versione nuova e la si scarica in background; poi il renderer apre «Aggiornamento
 * disponibile» con Aggiorna ora / Più tardi / Salta questa versione. Solo nell'app installata.
 */

const { autoUpdater } = electronUpdater;
const STARTUP_DELAY_MS = 3000;
const PrefsSchema = z.object({ skippedVersion: z.string().nullable().default(null) });

export function registerUpdates(): { checkOnStartup: () => void } {
  const prefsPath = join(app.getPath('userData'), 'updates.json');
  const readSkipped = (): string | null => {
    try {
      return PrefsSchema.parse(JSON.parse(readFileSync(prefsPath, 'utf8'))).skippedVersion;
    } catch {
      return null;
    }
  };
  const enabled = app.isPackaged;
  let state: UpdateState = {
    currentVersion: app.getVersion(),
    status: enabled ? 'inattivo' : 'disattivato',
    prompt: false,
  };
  let manual = false;

  const publish = (next: Partial<UpdateState>) => {
    state = { ...state, ...next };
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(UPDATE_STATE_EVENT, state);
    }
  };

  autoUpdater.autoDownload = true;
  // Se l'utente sceglie «Più tardi», la versione scaricata si installa alla chiusura.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: () => {},
    warn: console.warn,
    error: console.error,
    debug: () => {},
  };
  autoUpdater.on('checking-for-update', () => publish({ status: 'controllo', error: undefined }));
  autoUpdater.on('update-not-available', () => publish({ status: 'aggiornato', prompt: manual }));
  autoUpdater.on('update-available', (info) =>
    publish({ status: 'download', version: info.version, percent: 0 }),
  );
  autoUpdater.on('download-progress', (progress) =>
    publish({ status: 'download', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    publish({
      status: 'pronto',
      version: info.version,
      notes: releaseNotesText(info.releaseNotes),
      percent: 100,
      prompt: shouldPrompt(info.version, readSkipped(), manual),
    }),
  );
  autoUpdater.on('error', (error) =>
    // All'avvio un errore (es. offline) non apre nulla: si riprova alla prossima apertura.
    publish({ status: 'errore', error: updateErrorMessage(error), prompt: manual }),
  );

  const check = async (byHand: boolean) => {
    if (!enabled) return state;
    manual = byHand;
    if (state.status === 'pronto') {
      publish({ prompt: true });
      return state;
    }
    if (state.status === 'controllo' || state.status === 'download') return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // Già pubblicato dall'evento `error`.
    }
    return state;
  };

  ipcMain.handle(IPC.updateState, () => state);
  ipcMain.handle(IPC.updateCheck, () => check(true));
  ipcMain.handle(IPC.updateDismiss, () => publish({ prompt: false }));
  ipcMain.handle(IPC.updateSkip, () => {
    if (state.version) {
      writeFileSync(prefsPath, JSON.stringify({ skippedVersion: state.version }), 'utf8');
    }
    publish({ prompt: false });
  });
  ipcMain.handle(IPC.updateInstall, () => {
    if (state.status !== 'pronto') return;
    // Installazione silenziosa, poi Prisma si riapre da solo.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  return {
    checkOnStartup: () => {
      if (enabled) setTimeout(() => void check(false), STARTUP_DELAY_MS);
    },
  };
}
