import type {
  Content,
  PublicationView,
  QueueCheck,
  VariantFormat,
  VariantStatus,
} from '@prisma-app/shared';
import { STATUS_DISPLAY, socialCaption } from '@prisma-app/shared';
import { whenLabel } from './calendar';

const pad = (n: number) => String(n).padStart(2, '0');

/** Post in uscita: programmati o in invio, dal più vicino. */
export function queuedPublications(publications: readonly PublicationView[]): PublicationView[] {
  return publications
    .filter((p) => p.status === 'programmato' || p.status === 'in_pubblicazione')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** Log: pubblicati, errori e annullati, dal più recente. */
export function logPublications(
  publications: readonly PublicationView[],
  limit = 20,
): PublicationView[] {
  const moment = (p: PublicationView) => p.publishedAt ?? p.updatedAt;
  return publications
    .filter((p) => p.status === 'pubblicato' || p.status === 'errore' || p.status === 'annullato')
    .sort((a, b) => moment(b).localeCompare(moment(a)))
    .slice(0, limit);
}

/**
 * Quando lo scheduler prenderà davvero il post: `next_attempt_at`, che dopo "Pubblica ora",
 * "Riprova" o un errore temporaneo (backoff) può differire dall'orario programmato.
 */
export function nextRunAt(publication: PublicationView): string {
  return publication.nextAttemptAt ?? publication.scheduledAt;
}

/** "esce tra" al primo invio, "nuovo tentativo tra" dopo un tentativo fallito. */
export function countdownLabel(publication: PublicationView): string {
  return publication.attempts > 0 ? 'nuovo tentativo tra' : 'esce tra';
}

/** Conto alla rovescia "3:42:05"; zero quando l'orario è passato (sta per partire). */
export function countdown(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((new Date(iso).getTime() - now.getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${pad(m)}:${pad(seconds % 60)}`;
}

/** Versione breve per la dashboard: "tra 0:42", "tra 23:42" (ore:minuti). */
export function countdownShort(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000));
  return `tra ${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

const FORMAT_LABELS: Record<VariantFormat, string> = {
  post: 'Post',
  carosello: 'Carosello',
  reel: 'Reel',
  storia: 'Storia',
  video: 'Video',
  short: 'Short',
  articolo: 'Articolo',
};

export function formatLabel(format: VariantFormat): string {
  return FORMAT_LABELS[format];
}

/**
 * "Post · dom 22 nov · 17:00"; per i video caricati in anticipo (YouTube) anche lo stato del
 * caricamento: già sulla piattaforma con uscita programmata, o l'errore dell'ultimo tentativo.
 */
export function queueSubtitle(publication: PublicationView): string {
  const base = `${formatLabel(publication.format)} · ${whenLabel(publication.scheduledAt)}`;
  if (publication.status !== 'programmato') return base;
  if (publication.externalId) return `${base} · già caricato, esce da solo all’orario`;
  if (publication.lastError?.startsWith('Caricamento anticipato')) {
    return `${base} · ${publication.lastError}`;
  }
  return base;
}

/** TikTok (casella dell'app): il video è una bozza, la pubblicazione la completa l'autore. */
export function isInboxDelivery(publication: PublicationView): boolean {
  return publication.platform === 'tiktok' && publication.status === 'pubblicato';
}

/** Etichetta dello stato nel log: per TikTok «Inviato a TikTok», non «Pubblicato». */
export function logStatusLabel(publication: PublicationView): string {
  return isInboxDelivery(publication)
    ? 'Inviato a TikTok'
    : STATUS_DISPLAY[publication.status].label;
}

/** Didascalia da incollare nell'app TikTok, dalla variant della pubblicazione. */
export function captionFor(
  contents: readonly Content[],
  publication: PublicationView,
): string | null {
  for (const content of contents) {
    const variant = content.variants.find((v) => v.id === publication.variantId);
    if (variant) return socialCaption(variant);
  }
  return null;
}

/** Testo sotto ogni riga del log: link al post, errore o motivo dell'annullamento. */
export function logDetail(publication: PublicationView): { text: string; isError: boolean } {
  if (publication.status === 'errore') {
    return { text: publication.lastError ?? 'Errore senza dettagli', isError: true };
  }
  if (publication.status === 'annullato') {
    return { text: 'tolto dalla coda · la bozza resta approvata', isError: false };
  }
  if (isInboxDelivery(publication)) {
    return {
      text: 'nella casella dell’app: apri la notifica, incolla la didascalia e pubblica',
      isError: false,
    };
  }
  const link = publication.externalUrl ? shortUrl(publication.externalUrl) : 'pubblicato';
  const warning = publication.lastError ? ` · ${publication.lastError}` : '';
  return { text: `${link}${warning}`, isError: false };
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 24 ? `${parsed.pathname.slice(0, 24)}…` : parsed.pathname;
    return `${parsed.host.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

/** Ora e giorno del log, "ven 20 · 13:00". */
export function logWhen(publication: PublicationView): string {
  return whenLabel(publication.publishedAt ?? publication.scheduledAt).replace(/ (\w+) ·/, ' ·');
}

export interface CheckChip {
  mark: string;
  text: string;
  token: 'pub' | 'review' | 'err';
}

/** Controlli come nel mockup: "OK" verde, "!" arancione, "✕" rosso per ciò che blocca. */
export function checkChips(checks: readonly QueueCheck[]): CheckChip[] {
  const order = { error: 0, warning: 1, ok: 2 } as const;
  return [...checks]
    .sort((a, b) => order[a.level] - order[b.level])
    .map((check) => ({
      mark: check.level === 'ok' ? 'OK' : check.level === 'warning' ? '!' : '✕',
      text: check.message,
      token: check.level === 'ok' ? 'pub' : check.level === 'warning' ? 'review' : 'err',
    }));
}

const WAITING: readonly VariantStatus[] = ['bozza', 'da_approvare'];

/** Bozze che restano fuori dalla coda finché non vengono approvate. */
export function waitingDrafts(contents: readonly Content[]): number {
  return contents.flatMap((c) => c.variants).filter((v) => WAITING.includes(v.status)).length;
}

/** "4 post approvati in uscita · 1 bozza resta fuori finché non la approvi" */
export function queueSummary(queued: number, drafts: number): string {
  const head = `${queued} ${queued === 1 ? 'post approvato' : 'post approvati'} in uscita`;
  if (drafts === 0) return head;
  return drafts === 1
    ? `${head} · 1 bozza resta fuori finché non la approvi`
    : `${head} · ${drafts} bozze restano fuori finché non le approvi`;
}
