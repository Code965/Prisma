/**
 * Dettatura delle idee: il microfono si registra nel renderer e il main lo trascrive in locale
 * con whisper.cpp (stessi strumenti dei video). Qui la logica pura.
 */

export type DictationPhase = 'pronto' | 'ascolto' | 'trascrivo';

/** Al massimo 5 minuti: poi la registrazione si ferma da sola. */
export const DICTATION_MAX_MS = 5 * 60 * 1000;

export function canDictate(): boolean {
  return typeof window !== 'undefined' && Boolean(window.prisma?.dictation);
}

/** Il testo dettato si aggiunge a quello già scritto, separato da uno spazio. */
export function appendDictation(current: string, dictated: string): string {
  const text = dictated.trim();
  if (!text) return current;
  const before = current.trimEnd();
  return before ? `${before} ${text}` : text;
}

/** Audio per MediaRecorder: Opus in WebM se c'è (FFmpeg lo legge), altrimenti il predefinito. */
export function pickAudioMime(isSupported: (mime: string) => boolean): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(isSupported);
}

export function micTitle(phase: DictationPhase, available: boolean): string {
  if (!available) return 'Dettatura disponibile solo nell’app desktop';
  if (phase === 'ascolto') return 'Ferma e trascrivi';
  if (phase === 'trascrivo') return 'Trascrivo con Whisper…';
  return 'Detta un’idea (Whisper sul computer)';
}

/** Messaggio quando la dettatura non trova parole. */
export const NOTHING_HEARD = 'Non ho sentito parole: riprova parlando più vicino al microfono';

/** Errore da mostrare: senza il prefisso che Electron aggiunge agli errori del main. */
export function dictationError(error: unknown): string {
  if (!(error instanceof Error)) return 'Dettatura non riuscita';
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
