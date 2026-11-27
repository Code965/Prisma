import {
  PLAN_ITEM_PROGRESS_LABELS,
  PLAN_MONTHS_AHEAD,
  PLAN_SOURCE_LABELS,
  POST_FORMAT_LABELS,
  type EditorialPlan,
  type Idea,
  type Platform,
  type PlanItem,
  type PlanItemReview,
  type PlanReview,
  type PlanState,
  type Tag,
} from '@prisma-app/shared';
import { addMonths, zonedParts, type DayKey } from './zoned-time';

/**
 * Piano editoriale mensile (fase 8e): mesi, raggruppamento delle idee per giorno, frequenze,
 * pilastri e revisione. Funzioni pure: la schermata mostra, il server decide.
 */

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const pad = (n: number) => String(n).padStart(2, '0');

export const currentMonth = (now: Date) => zonedParts(now).day.slice(0, 7);
export const shiftMonth = (month: string, months: number) =>
  addMonths(`${month}-01`, months).slice(0, 7);

/** «dicembre 2026». */
export function monthTitle(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('it-IT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, m - 1, 15)));
}

/** Mesi raggiungibili con le frecce: i passati (per rivederli) e fino a due mesi avanti. */
export function canGoForward(month: string, now: Date): boolean {
  return month < shiftMonth(currentMonth(now), PLAN_MONTHS_AHEAD);
}

const weekdayOf = (day: DayKey) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

/** «mar 1». */
export const dayLabel = (day: DayKey) => `${WEEKDAYS[weekdayOf(day)]} ${Number(day.slice(8))}`;

export const slotLabel = (slot: { weekday: number; hour: number }) =>
  `${WEEKDAYS[slot.weekday]} ${pad(slot.hour)}:00`;

export interface PlanItemRow {
  item: PlanItem;
  formatLabel: string;
  sourceLabel: string;
  time: string | null;
  review: PlanItemReview | null;
  progressLabel: string;
  /** L'idea non esiste ancora: si può creare. */
  pending: boolean;
}

export interface PlanDayGroup {
  day: DayKey;
  label: string;
  past: boolean;
  rows: PlanItemRow[];
  /** Uscite già in calendario quel giorno (non del piano). */
  booked: PlanState['booked'];
}

/** Le idee del piano per giorno, con le uscite già fissate negli stessi giorni. */
export function dayGroups(state: PlanState, now: Date): PlanDayGroup[] {
  const plan = state.plan;
  if (!plan) return [];
  const today = zonedParts(now).day;
  const reviews = new Map(state.review?.items.map((r) => [r.itemId, r]) ?? []);
  const days = [...new Set(plan.items.map((i) => i.day))].sort();
  return days.map((day) => ({
    day,
    label: dayLabel(day),
    past: day < today,
    rows: plan.items
      .filter((i) => i.day === day)
      .map((item) => {
        const review = reviews.get(item.id) ?? null;
        const progress = review?.progress ?? (item.ideaId !== null ? 'idea' : 'da_creare');
        return {
          item,
          formatLabel: POST_FORMAT_LABELS[item.format],
          sourceLabel: PLAN_SOURCE_LABELS[item.source],
          time: item.hour !== null ? `${pad(item.hour)}:00` : null,
          review,
          progressLabel: review?.late ? 'In ritardo' : PLAN_ITEM_PROGRESS_LABELS[progress],
          pending: progress === 'da_creare',
        };
      }),
    booked: state.booked.filter((b) => b.day === day),
  }));
}

/** Voci senza idea (da creare) e quelle con l'idea ma senza giorno nel calendario. */
export function pendingItemIds(plan: EditorialPlan | null, review: PlanReview | null): string[] {
  if (!plan) return [];
  const progress = new Map(review?.items.map((r) => [r.itemId, r.progress]) ?? []);
  return plan.items
    .filter(
      (i) => (progress.get(i.id) ?? (i.ideaId === null ? 'da_creare' : 'idea')) === 'da_creare',
    )
    .map((i) => i.id);
}

export interface PillarRow {
  name: string;
  description: string;
  tagName: string | null;
  ideas: number;
}

export function pillarRows(plan: EditorialPlan, tags: readonly Tag[]): PillarRow[] {
  return plan.pillars.map((p) => ({
    name: p.name,
    description: p.description,
    tagName: tags.find((t) => t.id === p.tagId)?.name ?? null,
    ideas: plan.items.filter((i) => i.pillar === p.name).length,
  }));
}

export interface FrequencyRow {
  platform: Platform;
  perWeek: string;
  formats: string;
  slots: string;
  note: string;
  ideas: number;
}

export function frequencyRows(plan: EditorialPlan): FrequencyRow[] {
  return plan.frequencies.map((f) => ({
    platform: f.platform,
    perWeek: `${f.perWeek} a settimana`,
    formats: f.formats.map((x) => POST_FORMAT_LABELS[x]).join(', '),
    slots: f.slots.map(slotLabel).join(', ') || 'orari consigliati',
    note: f.note,
    ideas: plan.items.filter((i) => i.platform === f.platform).length,
  }));
}

/** Numeri principali della revisione, nell'ordine in cui si mostrano. */
export function reviewTiles(review: PlanReview): Array<{ label: string; value: string }> {
  const t = review.totals;
  return [
    { label: 'Idee create', value: `${t.ideas}/${t.items}` },
    { label: 'In lavorazione', value: String(t.drafts) },
    { label: 'Programmate', value: String(t.scheduled) },
    { label: 'Pubblicate', value: String(t.published) },
    { label: 'In ritardo', value: String(t.late) },
    { label: 'Fuori dal piano', value: String(review.outsidePlan) },
  ];
}

export function elapsedLabel(review: PlanReview): string {
  const percent = Math.round(review.elapsed * 100);
  return percent >= 100 ? 'Mese concluso' : `Mese trascorso al ${percent}%`;
}

/** «Nuovo piano» o perché non si può; «Rigenera» quando c'è già. */
export function planSubtitle(state: PlanState | undefined): string {
  if (!state) return 'Carico il piano…';
  if (!state.plan) return state.blocked ?? 'Nessun piano per questo mese: generalo con l’AI.';
  const ideas = state.plan.items.length;
  return `${state.plan.pillars.length} pilastri · ${ideas} idee · ${state.plan.frequencies.length} piattaforme`;
}

/** Idee con un giorno proposto dal piano, ancora da fare, per giorno (Calendario). */
export function plannedIdeasByDay(ideas: readonly Idea[]): Map<DayKey, Idea[]> {
  const map = new Map<DayKey, Idea[]>();
  for (const idea of ideas) {
    if (!idea.plannedDay || idea.status === 'usata' || idea.status === 'archiviata') continue;
    map.set(idea.plannedDay, [...(map.get(idea.plannedDay) ?? []), idea]);
  }
  return map;
}

/** «ven 13 mar»: il giorno proposto dal piano, per le idee. */
export function plannedDayLabel(day: DayKey): string {
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}
