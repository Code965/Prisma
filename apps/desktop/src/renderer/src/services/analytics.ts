import {
  ANALYTICS_METRIC_LABELS,
  PLATFORM_LABELS,
  type AnalyticsMetric,
  type AnalyticsReport,
  type ManualMetricsInput,
  type Platform,
  type PlatformSeries,
  type PublicationMetrics,
  type TopContent,
} from '@prisma-app/shared';
import { formatLabel } from './queue';

/**
 * Numeri compatti come nel mockup: «9,8k», «1.240». La copertura dei contenuti usa le migliaia
 * già da 1.000 («6,4k»), le interazioni no.
 */
export function compactNumber(value: number, kFrom = 10_000): string {
  if (Math.abs(value) >= kFrom)
    return `${(value / 1000).toFixed(1).replace('.', ',')}k`.replace(',0k', 'k');
  return new Intl.NumberFormat('it-IT', { useGrouping: 'always', maximumFractionDigits: 0 }).format(
    value,
  );
}

export interface PlatformCard {
  platform: Platform;
  name: string;
  /** Somma del periodo, «—» senza dati. */
  total: string;
  /** Variazione dell'ultimo intervallo sul precedente, null se non calcolabile. */
  delta: { text: string; positive: boolean } | null;
  bars: Array<{ height: string; tip: string; current: boolean; empty: boolean }>;
  aria: string;
  note: string | null;
  hasData: boolean;
}

const NO_DATA_NOTE: Record<Platform, string> = {
  linkedin: 'Nessun dato: inserisci le metriche dei post LinkedIn qui sotto',
  instagram: 'Nessun dato: collega l’account Instagram',
  tiktok: 'Nessun dato: collega TikTok e pubblica dalla casella',
  youtube: 'Nessun dato: collega il canale YouTube',
  blog: 'Il blog non ha metriche',
};

/** Riquadro di una piattaforma per la metrica scelta (piccoli multipli del mockup). */
export function platformCard(
  series: PlatformSeries,
  metric: AnalyticsMetric,
  report: Pick<AnalyticsReport, 'buckets' | 'period'>,
): PlatformCard {
  const values = series.series[metric];
  const present = values.filter((v): v is number => v !== null);
  const max = Math.max(1, ...present.map((v) => Math.abs(v)));
  const last = values[values.length - 1] ?? null;
  const prev = values[values.length - 2] ?? null;
  const unit = report.period === '30d' ? 'giorno' : 'sett.';
  const delta =
    last !== null && prev !== null && prev !== 0
      ? (() => {
          const pct = Math.round(((last - prev) / Math.abs(prev)) * 100);
          return { text: `${pct >= 0 ? '+' : ''}${pct}% ${unit}`, positive: pct >= 0 };
        })()
      : null;
  const name = PLATFORM_LABELS[series.platform];
  const label = ANALYTICS_METRIC_LABELS[metric].toLowerCase();
  return {
    platform: series.platform,
    name,
    total: present.length ? compactNumber(present.reduce((a, b) => a + b, 0)) : '—',
    delta,
    bars: values.map((value, i) => ({
      height: value === null ? '0%' : `${Math.round((Math.abs(value) / max) * 100)}%`,
      tip: `${report.buckets[i]?.label ?? ''}: ${value === null ? 'nessun dato' : compactNumber(value)}`,
      current: i === values.length - 1,
      empty: value === null,
    })),
    aria: `${name}, ${label}: ${values.map((v) => (v === null ? 'nessun dato' : compactNumber(v))).join(', ')}`,
    // I follower LinkedIn non si possono inserire: la nota spiega che mancano del tutto.
    note:
      present.length || (series.platform === 'linkedin' && metric === 'followers')
        ? series.notes[metric]
        : NO_DATA_NOTE[series.platform],
    hasData: present.length > 0,
  };
}

export interface TopRow {
  n: number;
  platform: Platform;
  title: string;
  format: string;
  reach: string;
  reachTitle: string | undefined;
  interactions: string;
  url: string | null;
}

export function topRows(top: readonly TopContent[]): TopRow[] {
  return top.map((t, i) => ({
    n: i + 1,
    platform: t.platform,
    title: t.title,
    format: `${formatLabel(t.format)} · ${PLATFORM_LABELS[t.platform]}`,
    reach: t.reach === null ? '—' : compactNumber(t.reach, 1000),
    reachTitle: t.reachKind && t.reachKind !== 'copertura' ? `Valore: ${t.reachKind}` : undefined,
    interactions: t.interactions === null ? '—' : compactNumber(t.interactions),
    url: t.externalUrl,
  }));
}

/** Etichette dei campi LinkedIn (reazioni → likes, diffusioni → shares). */
export const LINKEDIN_FIELDS = [
  ['impressions', 'Impressioni'],
  ['likes', 'Reazioni'],
  ['comments', 'Commenti'],
  ['shares', 'Diffusioni'],
] as const satisfies ReadonlyArray<readonly [keyof ManualMetricsInput, string]>;

export type LinkedInDraft = Record<(typeof LINKEDIN_FIELDS)[number][0], string>;

export function linkedinDraft(metrics: PublicationMetrics | null): LinkedInDraft {
  const value = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    impressions: value(metrics?.impressions),
    likes: value(metrics?.likes),
    comments: value(metrics?.comments),
    shares: value(metrics?.shares),
  };
}

/** Bozza del modulo → richiesta; null se vuota o con valori non validi. */
export function manualInput(draft: LinkedInDraft): ManualMetricsInput | null {
  const input: ManualMetricsInput = {};
  for (const [key] of LINKEDIN_FIELDS) {
    const text = draft[key].trim().replace(/\./g, '');
    if (!text) continue;
    if (!/^\d+$/.test(text)) return null;
    input[key] = Number(text);
  }
  return Object.keys(input).length ? input : null;
}

/** Riassunto delle metriche inserite: «4.700 impressioni · 120 reazioni». */
export function manualSummary(metrics: PublicationMetrics | null): string {
  if (!metrics) return 'Metriche non ancora inserite';
  const parts = LINKEDIN_FIELDS.flatMap(([key, label]) => {
    const value = metrics[key];
    return value === null ? [] : [`${compactNumber(value)} ${label.toLowerCase()}`];
  });
  return parts.join(' · ') || 'Metriche non ancora inserite';
}
