import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { musicFileFromUrl } from './music.js';

/**
 * Protocollo `prisma-media://video/<id>` per riprodurre nel renderer i video dei progetti (e
 * `prisma-media://musica/<nome>` per i brani della cartella della musica).
 * Il renderer non conosce né può chiedere percorsi arbitrari: si servono solo i file sorgente
 * dei progetti registrati. `stream` abilita le richieste a intervalli (Range) del player.
 */
export const MEDIA_SCHEME = 'prisma-media';

/** Va chiamata prima di `app.ready`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ]);
}

/** Id del progetto da un indirizzo `prisma-media://video/<uuid>`; null se non è valido. */
export function projectIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== 'video') return null;
    const id = parsed.pathname.replace(/^\/+/, '');
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function handleMediaProtocol(
  sourcePathOf: (projectId: string) => string | null,
  /** Brani della cartella della musica (`prisma-media://musica/<nome>`), solo quella cartella. */
  musicPathOf: (fileName: string) => Promise<string | null>,
): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const id = projectIdFromUrl(request.url);
    const music = id ? null : musicFileFromUrl(request.url);
    const path = id ? sourcePathOf(id) : music ? await musicPathOf(music) : null;
    if (!path) return new Response('Non trovato', { status: 404 });
    // Si inoltrano gli header (Range compreso): il caricamento dei file gestisce gli intervalli.
    return net.fetch(pathToFileURL(path).toString(), { headers: request.headers });
  });
}
