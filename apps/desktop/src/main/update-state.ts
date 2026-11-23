/**
 * Stato degli aggiornamenti condiviso tra main e renderer. Funzioni pure: il main le usa per
 * passare da un evento di electron-updater al prossimo stato, i test le provano senza Electron.
 */

export type UpdateStatus =
  /** App non installata (sviluppo): gli aggiornamenti non si cercano. */
  | 'disattivato'
  | 'inattivo'
  | 'controllo'
  | 'download'
  /** Scaricato: si installa chiudendo e riaprendo Prisma. */
  | 'pronto'
  | 'aggiornato'
  | 'errore';

export interface UpdateState {
  currentVersion: string;
  status: UpdateStatus;
  /** Versione nuova trovata (da `download` in poi). */
  version?: string;
  /** Novità della versione, testo semplice. */
  notes?: string;
  percent?: number;
  error?: string;
  /** Il renderer deve aprire la finestra «Aggiornamento disponibile». */
  prompt: boolean;
}

export interface ReleaseNoteInfo {
  version: string;
  note: string | null;
}

/** Le note di GitHub arrivano in HTML (o come elenco per versione): diventano testo semplice. */
export function releaseNotesText(
  notes: string | ReleaseNoteInfo[] | null | undefined,
): string | undefined {
  if (!notes) return undefined;
  const html = Array.isArray(notes)
    ? notes.map((item) => `<p>${item.version}</p>${item.note ?? ''}`).join('\n')
    : notes;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|h[1-6]|ul|ol|div)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/**
 * A download finito la finestra si apre, salvo che l'utente abbia saltato proprio quella
 * versione. Una verifica chiesta a mano la mostra comunque.
 */
export function shouldPrompt(version: string, skipped: string | null, manual: boolean): boolean {
  return manual || version !== skipped;
}

/** Messaggio d'errore leggibile: senza rete o con il repository non raggiungibile. */
export function updateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(message)) {
    return 'Server degli aggiornamenti non raggiungibile: controlla la connessione.';
  }
  if (/404/.test(message)) return 'Nessuna release pubblicata trovata su GitHub.';
  return message.split('\n')[0]!.slice(0, 200);
}
