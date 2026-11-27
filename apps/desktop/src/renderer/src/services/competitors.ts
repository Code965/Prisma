import {
  CompetitorPostInputSchema,
  PLATFORM_FORMATS,
  PLATFORM_LABELS,
  type Competitor,
  type CompetitorAnalysis,
  type CompetitorPlatform,
  type CompetitorPostInput,
  type CompetitorsState,
  type ProfileStats,
  type VariantFormat,
} from '@prisma-app/shared';
import { compactNumber } from './trends';
import { zonedToUtc, type DayKey } from './zoned-time';

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

/** «3,2%» con un decimale (sotto l'1% due). */
export function percent(rate: number | null): string {
  if (rate === null) return '—';
  const value = rate * 100;
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: value < 1 ? 2 : 1 }).format(value)}%`;
}

export function slotLabel(slot: { weekday: number; hour: number }): string {
  return `${WEEKDAYS[slot.weekday] ?? '?'} ${String(slot.hour).padStart(2, '0')}:00`;
}

/** «tasso mediano 3,2% sulle visualizzazioni» o cosa manca per calcolarlo. */
export function rateText(stats: ProfileStats): string {
  if (stats.medianRate === null) {
    return stats.posts === 0
      ? 'nessun post negli ultimi 90 giorni'
      : 'tasso non calcolabile: servono visualizzazioni o follower';
  }
  return `tasso mediano ${percent(stats.medianRate)} ${stats.basis === 'visualizzazioni' ? 'sulle visualizzazioni' : 'sui follower'}`;
}

/** Righe brevi sotto il nome: frequenza, tasso, follower. */
export function statsLines(stats: ProfileStats, platform: CompetitorPlatform): string[] {
  const lines: string[] = [];
  const one = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
  if (stats.postsPerWeek !== null) {
    lines.push(
      `${one.format(stats.postsPerWeek)} post a settimana (${stats.posts} in ${one.format(stats.weeks)} sett.)`,
    );
  }
  lines.push(rateText(stats));
  if (stats.followers !== null) {
    lines.push(
      `${compactNumber(stats.followers)} ${platform === 'youtube' ? 'iscritti' : 'follower'}`,
    );
  }
  return lines;
}

export interface ComparisonRow {
  key: string;
  name: string;
  isOwn: boolean;
  postsPerWeek: number | null;
  rate: number | null;
  basis: ProfileStats['basis'];
  bestFormat: VariantFormat | null;
  bestSlot: string | null;
}

export interface ComparisonGroup {
  platform: CompetitorPlatform;
  label: string;
  rows: ComparisonRow[];
  /** Le basi dei tassi sono diverse: non si confrontano direttamente. */
  mixedBases: boolean;
}

function row(key: string, name: string, isOwn: boolean, stats: ProfileStats): ComparisonRow {
  return {
    key,
    name,
    isOwn,
    postsPerWeek: stats.postsPerWeek,
    rate: stats.medianRate,
    basis: stats.basis,
    bestFormat: stats.formats[0]?.format ?? null,
    bestSlot: stats.slots[0] ? slotLabel(stats.slots[0]) : null,
  };
}

/** Confronto per piattaforma: «Tu» (se ci sono metriche) e i concorrenti con dei post. */
export function comparisonGroups(state: CompetitorsState | undefined): ComparisonGroup[] {
  if (!state) return [];
  const platforms = [...new Set(state.competitors.map((c) => c.platform))];
  return platforms
    .map((platform) => {
      const own = state.own.find((o) => o.platform === platform);
      const rows = [
        ...(own ? [row('tu', 'Tu', true, own.stats)] : []),
        ...state.competitors
          .filter((c) => c.platform === platform && c.stats.posts > 0)
          .map((c) => row(`c${c.id}`, c.name, false, c.stats)),
      ];
      const bases = new Set(rows.map((r) => r.basis).filter(Boolean));
      return { platform, label: PLATFORM_LABELS[platform], rows, mixedBases: bases.size > 1 };
    })
    .filter((group) => group.rows.some((r) => !r.isOwn));
}

/** Post citati dall'analisi, con il concorrente e il link all'originale. */
export function analysisRefs(
  analysis: CompetitorAnalysis | null | undefined,
  competitors: readonly Competitor[],
): Map<number, { title: string; url: string; competitor: string }> {
  const refs = new Map<number, { title: string; url: string; competitor: string }>();
  if (!analysis) return refs;
  for (const c of competitors) {
    for (const p of c.posts) {
      refs.set(p.id, {
        title: p.title ?? p.text?.slice(0, 80) ?? 'Post',
        url: p.url,
        competitor: c.name,
      });
    }
  }
  return refs;
}

export const HANDLE_PLACEHOLDER: Record<CompetitorPlatform, string> = {
  youtube: '@canale o indirizzo del canale',
  linkedin: 'nome del profilo',
  instagram: '@profilo',
  tiktok: '@profilo',
};

/** Formati inseribili a mano per la piattaforma del concorrente. */
export function manualFormats(platform: CompetitorPlatform): readonly VariantFormat[] {
  return PLATFORM_FORMATS[platform];
}

export interface PostForm {
  title: string;
  text: string;
  url: string;
  day: string;
  time: string;
  format: VariantFormat;
  likes: string;
  comments: string;
  shares: string;
  views: string;
  followers: string;
}

export function emptyPostForm(platform: CompetitorPlatform, today: DayKey): PostForm {
  return {
    title: '',
    text: '',
    url: '',
    day: today,
    time: '09:00',
    format: manualFormats(platform)[0]!,
    likes: '',
    comments: '',
    shares: '',
    views: '',
    followers: '',
  };
}

const toCount = (value: string): number | null => {
  const clean = value.replace(/[.\s]/g, '').trim();
  return clean === '' ? null : Number(clean);
};

/** Modulo → richiesta validata (data e ora italiane); errore in italiano se qualcosa non va. */
export function postInput(form: PostForm): { input: CompetitorPostInput } | { error: string } {
  const [hour, minute] = form.time.split(':').map(Number);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.day) || hour === undefined || Number.isNaN(hour)) {
    return { error: 'Data o ora non valide' };
  }
  const parsed = CompetitorPostInputSchema.safeParse({
    title: form.title.trim() || null,
    text: form.text.trim() || null,
    url: form.url.trim(),
    publishedAt: zonedToUtc(form.day as DayKey, hour, minute ?? 0).toISOString(),
    format: form.format,
    likes: toCount(form.likes),
    comments: toCount(form.comments),
    shares: toCount(form.shares),
    views: toCount(form.views),
    followers: toCount(form.followers),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    if (field === 'url') return { error: 'Incolla il link del post (http o https)' };
    if (['likes', 'comments', 'shares', 'views', 'followers'].includes(String(field))) {
      return { error: 'I numeri devono essere interi, senza decimali' };
    }
    return { error: issue?.message ?? 'Dati non validi' };
  }
  return { input: parsed.data };
}
