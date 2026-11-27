import {
  TREND_MAX_KEYWORDS,
  TREND_SOURCE_LABELS,
  TrendKeywordSchema,
  type Tag,
  type TrendItem,
  type TrendReport,
  type TrendSignals,
  type TrendSource,
  type TrendsState,
} from '@prisma-app/shared';
import { UI_TIME_ZONE } from './dates';

/** Etichette dei segnali, nell'ordine in cui si mostrano. */
const SIGNALS: Array<[keyof TrendSignals, string, string]> = [
  ['points', 'punto', 'punti'],
  ['stars', 'stella', 'stelle'],
  ['reactions', 'reazione', 'reazioni'],
  ['views', 'visualizzazione', 'visualizzazioni'],
  ['likes', 'like', 'like'],
  ['comments', 'commento', 'commenti'],
];

/** «1.234», «12,3k», «1,2 Mln»: numeri veri della fonte, solo abbreviati. */
export function compactNumber(value: number): string {
  const format = (n: number, digits: number) =>
    new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(n);
  if (value >= 1_000_000) return `${format(value / 1_000_000, 1)} Mln`;
  if (value >= 10_000) return `${format(value / 1000, 1)}k`;
  return format(value, 0);
}

/** «412 punti · 87 commenti»: solo i segnali che la fonte ha dato. */
export function signalLabels(signals: TrendSignals): string[] {
  return SIGNALS.filter(([key]) => signals[key] !== undefined).map(([key, one, many]) => {
    const value = signals[key]!;
    return `${compactNumber(value)} ${value === 1 ? one : many}`;
  });
}

export interface TrendCard {
  title: string;
  summary: string;
  why: string;
  idea: string;
  tagId: number | null;
  tagName: string | null;
  scores: Array<{ label: string; value: number }>;
  sources: TrendSource[];
  items: Array<TrendItem & { sourceLabel: string; signalText: string }>;
}

/** Trend con i contenuti risolti e l'argomento del brand (se esiste ancora). */
export function trendCards(
  report: TrendReport | null | undefined,
  tags: readonly Tag[],
): TrendCard[] {
  if (!report) return [];
  const byId = new Map(report.items.map((item) => [item.id, item]));
  return report.trends.map((trend) => {
    const items = trend.itemIds
      .map((id) => byId.get(id))
      .filter((item): item is TrendItem => Boolean(item))
      .map((item) => ({
        ...item,
        sourceLabel: TREND_SOURCE_LABELS[item.source],
        signalText: signalLabels(item.signals).join(' · '),
      }));
    const tag = tags.find((t) => t.id === trend.tagId) ?? null;
    return {
      title: trend.title,
      summary: trend.summary,
      why: trend.why,
      idea: trend.idea,
      tagId: tag?.id ?? null,
      tagName: tag?.name ?? null,
      scores: [
        { label: 'Crescita', value: trend.scores.growth },
        { label: 'Interesse', value: trend.scores.interest },
        { label: 'Per te', value: trend.scores.fit },
      ],
      sources: [...new Set(items.map((item) => item.source))],
      items,
    };
  });
}

/** «DeepSeek · aggiornato oggi alle 08:12 · rust, typescript», o cosa fare se non c'è. */
export function trendsSubtitle(state: TrendsState | undefined): string {
  const report = state?.report;
  if (!report) return 'Una volta al giorno da Hacker News, GitHub, dev.to e YouTube';
  const provider = report.model.split(':')[0] ?? report.model;
  const name = provider === 'deepseek' ? 'DeepSeek' : provider;
  const when = new Intl.DateTimeFormat('it-IT', {
    timeZone: UI_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(report.createdAt));
  return `${name} · aggiornato ${when}`;
}

/** Fonti che non hanno dato risultati, con il motivo. */
export function sourceNotes(report: TrendReport | null | undefined): string[] {
  return (report?.sources ?? [])
    .filter((s) => s.error)
    .map((s) => `${TREND_SOURCE_LABELS[s.source]}: ${s.error}`);
}

/** Aggiunge una parola al radar: errore in italiano se non va bene. */
export function addKeyword(
  keywords: readonly string[],
  raw: string,
): { keywords: string[] } | { error: string } {
  const parsed = TrendKeywordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Parola non valida' };
  }
  const word = parsed.data;
  if (keywords.some((k) => k.toLowerCase() === word.toLowerCase())) {
    return { error: 'Parola già presente' };
  }
  if (keywords.length >= TREND_MAX_KEYWORDS) {
    return { error: `Al massimo ${TREND_MAX_KEYWORDS} parole` };
  }
  return { keywords: [...keywords, word] };
}

/** Argomenti del brand da proporre come parole (quelli non già presenti). */
export function keywordSuggestions(keywords: readonly string[], tags: readonly Tag[]): string[] {
  const used = new Set(keywords.map((k) => k.toLowerCase()));
  return tags
    .map((t) => t.name)
    .filter((name) => !used.has(name.toLowerCase()) && TrendKeywordSchema.safeParse(name).success);
}

/** Minuti che mancano prima di poter aggiornare di nuovo, o null. */
export function cooldownMinutes(state: TrendsState | undefined, now: Date): number | null {
  if (!state?.nextRefreshAt) return null;
  const ms = new Date(state.nextRefreshAt).getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 60_000) : null;
}
