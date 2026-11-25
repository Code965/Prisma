import { net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Protocollo `prisma-app://assets/<file>` per i file dell'app che il renderer deve leggere con
 * `fetch` (fase 6e: WebAssembly e modello di MediaPipe). Dalla build il renderer gira da
 * `file://`, dove `fetch` non funziona. Serve solo file della cartella `assets` del renderer, con
 * nomi semplici e le estensioni ammesse; la CSP apre `connect-src` a questo schema e non a
 * `prisma-media:`, così i video restano illeggibili come prima.
 */
export const APP_ASSET_SCHEME = 'prisma-app';

const CONTENT_TYPES: Record<string, string> = {
  wasm: 'application/wasm',
  js: 'text/javascript',
  tflite: 'application/octet-stream',
};

/** Nome del file da `prisma-app://assets/<file>`; null se non ammesso. */
export function appAssetName(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APP_ASSET_SCHEME}:` || parsed.hostname !== 'assets') return null;
    const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!/^[\w.-]+$/.test(name) || name.includes('..')) return null;
    const ext = name.split('.').pop()!.toLowerCase();
    return ext in CONTENT_TYPES ? name : null;
  } catch {
    return null;
  }
}

export function handleAppAssets(assetsDir: string): void {
  protocol.handle(APP_ASSET_SCHEME, async (request) => {
    const name = appAssetName(request.url);
    if (!name) return new Response('Non trovato', { status: 404 });
    const response = await net.fetch(pathToFileURL(join(assetsDir, name)).toString());
    if (!response.ok) return new Response('Non trovato', { status: 404 });
    const ext = name.split('.').pop()!.toLowerCase();
    // `application/wasm` serve a WebAssembly.instantiateStreaming.
    return new Response(response.body, {
      headers: {
        'content-type': CONTENT_TYPES[ext]!,
        // Richiesto dal fetch della pagina file:// (origine «null»): sono file pubblici dell'app.
        'access-control-allow-origin': '*',
      },
    });
  });
}
