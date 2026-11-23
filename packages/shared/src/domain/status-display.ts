import type { PublicationStatus } from './publication-state.js';
import type { VariantStatus } from './variant-state.js';

/** Token del design system: `--s-<token>` per il testo, `--s-<token>Bg` per lo sfondo. */
export type StatusToken = 'draft' | 'review' | 'ok' | 'sched' | 'pub' | 'err';

export interface StatusDisplay {
  label: string;
  short: string;
  token: StatusToken;
}

export const STATUS_DISPLAY: Record<VariantStatus | PublicationStatus, StatusDisplay> = {
  bozza: { label: 'Bozza', short: 'bozza', token: 'draft' },
  da_approvare: { label: 'Da approvare', short: 'da appr.', token: 'review' },
  approvato: { label: 'Approvato', short: 'appr.', token: 'ok' },
  programmato: { label: 'Programmato', short: 'progr.', token: 'sched' },
  in_pubblicazione: { label: 'In pubblicazione', short: 'in pubbl.', token: 'sched' },
  pubblicato: { label: 'Pubblicato', short: 'pubbl.', token: 'pub' },
  errore: { label: 'Errore', short: 'errore', token: 'err' },
  annullato: { label: 'Annullato', short: 'annull.', token: 'draft' },
};
