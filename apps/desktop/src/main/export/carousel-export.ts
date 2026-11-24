import type { ExportedFile, ExportFormat } from '@prisma-app/shared';
import {
  SLIDE_SIZE,
  renderCarouselPdfHtml,
  renderInputKey,
  renderSlideHtml,
} from '@prisma-app/templates';
import { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportCarouselRequest, ExportCarouselResult } from '../ipc-contract.js';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Nome della cartella di un export: variante, formato e istante, così gli export non si sovrascrivono. */
export function exportFolderName(variantId: number, format: ExportFormat, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return join(`variante-${variantId}`, `${stamp}-${format}`);
}

export function slideFileName(position: number): string {
  return `slide-${String(position + 1).padStart(2, '0')}.jpg`;
}

/**
 * Esporta il carosello: ogni slide in JPEG 1080×1350 (Instagram, TikTok) oppure tutte in un PDF
 * con pagine 1080×1350 (LinkedIn). Le pagine sono gli stessi documenti delle anteprime
 * dell'editor, con i font incorporati.
 */
export async function exportCarousel(
  request: ExportCarouselRequest,
  options: { rootDir: string; fontFaceCss: string; now?: Date },
): Promise<ExportCarouselResult> {
  const { carousel, kit, initials, format } = request;
  const folder = join(
    options.rootDir,
    exportFolderName(request.variantId, format, options.now ?? new Date()),
  );
  await mkdir(folder, { recursive: true });
  const context = { carousel, kit, initials, fontFaceCss: options.fontFaceCss };

  const files: ExportedFile[] = [];
  if (format === 'jpg') {
    for (let index = 0; index < carousel.slides.length; index++) {
      const jpeg = await captureJpeg(renderSlideHtml({ ...context, index }));
      const path = join(folder, slideFileName(index));
      await writeFile(path, jpeg);
      files.push(describe(index, 'image/jpeg', jpeg, path));
    }
  } else {
    const pdf = await printPdf(renderCarouselPdfHtml(context));
    const path = join(folder, 'carosello.pdf');
    await writeFile(path, pdf);
    files.push(describe(0, 'application/pdf', pdf, path));
  }

  return {
    format,
    folder,
    renderHash: sha256(renderInputKey(carousel, kit, initials)),
    files,
  };
}

function describe(
  position: number,
  mime: ExportedFile['mime'],
  data: Buffer,
  localPath: string,
): ExportedFile {
  return {
    position,
    mime,
    sizeBytes: data.length,
    width: SLIDE_SIZE.width,
    height: SLIDE_SIZE.height,
    checksumSha256: sha256(data),
    localPath,
  };
}

/**
 * Finestra invisibile che non può navigare né aprire altre finestre. Per le immagini è offscreen:
 * una finestra nascosta normale non produce fotogrammi da catturare.
 */
function renderWindow(offscreen: boolean): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    width: SLIDE_SIZE.width,
    height: SLIDE_SIZE.height,
    useContentSize: true,
    webPreferences: {
      offscreen,
      sandbox: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  return window;
}

/** Carica il documento da un file temporaneo (i data URL lunghi sono fragili) e attende i font. */
async function load(window: BrowserWindow, html: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'prisma-export-'));
  const file = join(dir, 'slide.html');
  try {
    await writeFile(file, html, 'utf8');
    await window.loadFile(file);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Cattura con il protocollo DevTools, come Puppeteer: la finestra (anche offscreen) viene
 * ristretta all'altezza dello schermo e su un portatile 1350 px non ci stanno, mentre le
 * metriche emulate fissano la pagina a 1080×1350 con densità 1, qualunque sia lo schermo.
 */
export async function captureJpeg(html: string): Promise<Buffer> {
  const window = renderWindow(true);
  const cdp = window.webContents.debugger;
  try {
    cdp.attach('1.3');
    await withTimeout(load(window, html), 'caricamento');
    await withTimeout(
      cdp.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: SLIDE_SIZE.width,
        height: SLIDE_SIZE.height,
        deviceScaleFactor: 1,
        mobile: false,
      }),
      'emulazione',
    );
    const { data } = (await withTimeout(
      cdp.sendCommand('Page.captureScreenshot', {
        // Qualità alta: il testo resta nitido e un file sta sotto i 300 KB (Instagram: max 8 MB).
        format: 'jpeg',
        quality: 92,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: SLIDE_SIZE.width, height: SLIDE_SIZE.height, scale: 1 },
      }),
      'cattura',
    )) as { data: string };
    return Buffer.from(data, 'base64');
  } finally {
    if (cdp.isAttached()) cdp.detach();
    window.destroy();
  }
}

async function printPdf(html: string): Promise<Buffer> {
  const window = renderWindow(false);
  try {
    await withTimeout(load(window, html), 'caricamento');
    return await withTimeout(
      window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }),
      'stampa PDF',
    );
  } finally {
    window.destroy();
  }
}

/** Un export non deve mai restare appeso: ogni passo ha un limite di tempo. */
function withTimeout<T>(promise: Promise<T>, step: string, ms = 20_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Export fermo durante: ${step}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
