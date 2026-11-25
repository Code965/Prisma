import {
  PLATFORMS,
  isVariantEditable,
  type ChatMessage,
  type Platform,
  type Variant,
  type VariantRevision,
  type VariantStatus,
} from '@prisma-app/shared';
import { changedLines, type DiffLine } from './diff';

/**
 * Limiti di lunghezza mostrati nei contatori. Verificati sulla documentazione: LinkedIn (step 7),
 * Instagram (2f) e YouTube (3f: titolo 100 caratteri, descrizione 5000 byte, qui contati come
 * caratteri; l'adapter controlla i byte e gli hashtag aggiunti in coda) e TikTok (Content Posting
 * API, novembre 2026: didascalia fino a 2200 unità UTF-16, quindi un'emoji può contare due; in
 * modalità casella la didascalia si incolla nell'app di TikTok).
 */
export const TEXT_LIMITS = {
  linkedin: { body: 3000 },
  instagram: { body: 2200 },
  tiktok: { body: 2200 },
  youtube: { body: 5000, title: 100, description: 5000 },
  // Blog: estratto per la meta description (160), titolo leggibile nei risultati di ricerca.
  blog: { body: 60000, title: 120, description: 160 },
} as const satisfies Record<Platform, { body: number; title?: number; description?: number }>;

/** Conta i caratteri come li vede chi legge (emoji e accenti contano uno). */
export function charCount(text: string): number {
  return [...text].length;
}

/** In italiano Intl non raggruppa i numeri di 4 cifre: il mockup però scrive "3.000". */
export function formatCount(count: number, limit: number): string {
  const it = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });
  return `${it.format(count)} / ${it.format(limit)}`;
}

export function sortVariants(variants: readonly Variant[]): Variant[] {
  return [...variants].sort(
    (a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform),
  );
}

/** Testo troncato come nei feed, con "… altro" quando supera la soglia. */
export function previewText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = [...text.trim()];
  if (chars.length <= maxChars) return { text: chars.join(''), truncated: false };
  return { text: chars.slice(0, maxChars).join('').trimEnd(), truncated: true };
}

/** Titolo grande delle anteprime visive: il titolo della variant o la prima riga del testo. */
export function headline(draft: Pick<Variant, 'body' | 'metadata'>, maxChars = 70): string {
  const source = draft.metadata.title ?? draft.body.split('\n').find((line) => line.trim()) ?? '';
  return previewText(source, maxChars).text;
}

/** La bozza locale differisce da quella salvata? */
export function isDirty(
  draft: Pick<Variant, 'body' | 'metadata'>,
  saved: Pick<Variant, 'body' | 'metadata'>,
): boolean {
  return (
    draft.body !== saved.body || JSON.stringify(draft.metadata) !== JSON.stringify(saved.metadata)
  );
}

/**
 * Hashtag scritto dall'utente nella forma che il server accetta: senza spazi né "#" iniziali
 * ripetuti, solo lettere, numeri e trattino basso. Null se non è valido.
 */
export function normalizeHashtag(input: string): string | null {
  const tag = input.trim().replace(/^#+/, '').replace(/\s+/g, '');
  return /^[\p{L}\p{N}_]+$/u.test(tag) ? `#${tag}` : null;
}

/** Una variant si modifica solo dove la macchina a stati lo permette. */
export function isReadOnly(status: VariantStatus): boolean {
  return !isVariantEditable(status);
}

/**
 * Passi per arrivare ad "approvato" da dove si è: salvare le modifiche e attraversare
 * `da_approvare` (la macchina a stati non permette di saltarlo).
 */
export function approvalSteps(
  status: VariantStatus,
  dirty: boolean,
): Array<'save' | 'submit' | 'approve'> {
  if (dirty && isReadOnly(status)) return [];
  // Dopo un salvataggio la variant torna sempre bozza.
  const afterSave: VariantStatus = dirty ? 'bozza' : status;
  const save = dirty ? (['save'] as const) : [];
  if (afterSave === 'bozza') return [...save, 'submit', 'approve'];
  if (afterSave === 'da_approvare') return [...save, 'approve'];
  return [];
}

export interface ChatItem {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Righe cambiate dalla modifica dell'assistente, se ricostruibili dallo storico. */
  diff: DiffLine[];
  /** Revisione a cui tornare per annullare questa modifica. */
  undoRevisionId: number | null;
  /**
   * La modifica è ancora quella in vigore (è l'ultima revisione della variant): solo allora
   * "annulla" ha senso. Dopo un annullamento o una modifica a mano non lo è più.
   */
  isCurrent: boolean;
}

/**
 * Messaggi della chat di una variant, con il diff di ogni modifica ricostruito dalle revisioni:
 * la revisione creata dall'assistente confrontata con quella precedente.
 */
export function chatItems(
  messages: readonly ChatMessage[],
  revisions: readonly VariantRevision[],
  variantId: number,
): ChatItem[] {
  const chronological = [...revisions].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
  );
  const latestId = chronological.at(-1)?.id ?? null;
  return messages
    .filter((message) => message.variantId === variantId)
    .map((message) => {
      const index = chronological.findIndex((r) => r.id === message.revisionId);
      const previous = index > 0 ? chronological[index - 1]! : null;
      const current = index >= 0 ? chronological[index]! : null;
      return {
        id: message.id,
        role: message.role,
        text: message.text,
        diff: previous && current ? changedLines(previous.body, current.body) : [],
        undoRevisionId: previous?.id ?? null,
        isCurrent: message.revisionId !== null && message.revisionId === latestId,
      };
    });
}

export const QUICK_INSTRUCTIONS = [
  'Accorcia',
  'Più tecnico',
  'Più personale',
  'Chiudi con una domanda',
] as const;
