import type { BrowserWindow } from 'electron';
import { Menu, Notification, Tray, app, ipcMain, nativeImage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { BackgroundSettingsSchema, IPC, type BackgroundSettings } from './ipc-contract.js';

/**
 * Prisma in background (fase 5f): chiudendo la finestra l'app resta nell'area di notifica e lo
 * scheduler continua a pubblicare; facoltativo l'avvio con Windows, nascosto. Solo con i dati sul
 * computer: con un server remoto è lui a pubblicare.
 */

/** Argomento dell'avvio con Windows: l'app parte senza intro e senza finestra. */
export const HIDDEN_ARG = '--nascosta';

const StoredSchema = z.object({
  keepRunning: z.boolean().default(true),
  openAtLogin: z.boolean().default(false),
  /** L'avviso «Prisma resta attiva» si mostra solo la prima volta. */
  notified: z.boolean().default(false),
});
type Stored = z.infer<typeof StoredSchema>;

export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_ARG);
}

export function setupBackground(options: {
  userDataDir: string;
  /** Con un server remoto lo scheduler non gira qui: nessuna area di notifica. */
  enabled: boolean;
  getWindow: () => BrowserWindow | null;
  icon?: string;
}): { attach: (window: BrowserWindow) => void } {
  const file = join(options.userDataDir, 'background.json');
  const read = (): Stored => {
    try {
      return StoredSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return StoredSchema.parse({});
    }
  };
  const write = (next: Stored) => writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  let settings = read();
  let quitting = false;
  let tray: Tray | null = null;

  const show = () => {
    const window = options.getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const applyLogin = () => {
    // In sviluppo l'eseguibile è Electron stesso: l'avvio con Windows vale solo per l'app installata.
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: [HIDDEN_ARG] });
  };

  const buildMenu = () =>
    Menu.buildFromTemplate([
      { label: 'Apri Prisma', click: show },
      { type: 'separator' },
      {
        label: 'Avvia con Windows',
        type: 'checkbox',
        checked: settings.openAtLogin,
        enabled: app.isPackaged,
        click: (item) => update({ openAtLogin: item.checked }),
      },
      { type: 'separator' },
      {
        label: 'Esci da Prisma',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);

  const update = (patch: Partial<BackgroundSettings>): BackgroundSettings => {
    settings = { ...settings, ...patch };
    write(settings);
    applyLogin();
    tray?.setContextMenu(buildMenu());
    return view();
  };

  const view = (): BackgroundSettings => ({
    keepRunning: settings.keepRunning,
    openAtLogin: settings.openAtLogin,
    available: options.enabled,
    canOpenAtLogin: app.isPackaged,
  });

  ipcMain.handle(IPC.backgroundGet, () => view());
  ipcMain.handle(IPC.backgroundSet, (_event, input: unknown) =>
    update(BackgroundSettingsSchema.parse(input)),
  );

  // Un secondo avvio (icona, menu Start) riapre la finestra di quello già attivo.
  app.on('second-instance', show);
  app.on('before-quit', () => {
    quitting = true;
  });

  if (!options.enabled) return { attach: () => {} };
  applyLogin();

  const icon = options.icon ? nativeImage.createFromPath(options.icon) : nativeImage.createEmpty();
  const createTray = (image: Electron.NativeImage) => {
    try {
      tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
      tray.setToolTip('Prisma · pubblica anche a finestra chiusa');
      tray.setContextMenu(buildMenu());
      tray.on('click', show);
    } catch (error) {
      console.error('Area di notifica non disponibile:', error);
    }
  };
  // Nell'app installata l'icona è quella dell'eseguibile.
  if (icon.isEmpty()) {
    void app
      .getFileIcon(process.execPath, { size: 'small' })
      .then(createTray)
      .catch(() => createTray(icon));
  } else {
    createTray(icon);
  }

  /** Chiudere la finestra la nasconde: Prisma resta attiva per lo scheduler. */
  return {
    attach(window) {
      window.on('close', (event) => {
        if (quitting || !settings.keepRunning) return;
        event.preventDefault();
        window.hide();
        if (!settings.notified && Notification.isSupported()) {
          new Notification({
            title: 'Prisma resta attiva',
            body: 'Pubblica le uscite programmate anche a finestra chiusa. La trovi nell’area di notifica.',
          }).show();
          settings = { ...settings, notified: true };
          write(settings);
        }
      });
    },
  };
}
