import {
  DEFAULT_RECOMMENDED_SLOTS,
  PLATFORMS,
  PLATFORM_LABELS,
  STATUS_DISPLAY,
  type Content,
  type Platform,
  type PublicationStatus,
  type PublicationView,
  type RecommendedSlots,
  type SlotMap,
  type Variant,
  type VariantStatus,
} from '@prisma-app/shared';
import { addDays, monthGrid, weekDays, zonedParts, zonedToUtc, type DayKey } from './zoned-time';

export type CalendarView = 'week' | 'month';

/**
 * Slot consigliati: dal server (calcolati dai post pubblicati, o predefiniti con pochi dati);
 * finché non arrivano valgono quelli del mockup (`DEFAULT_RECOMMENDED_SLOTS` in shared).
 */
export const RECOMMENDED_SLOTS: SlotMap = DEFAULT_RECOMMENDED_SLOTS;

/** Ora consigliata per una piattaforma in quel giorno, o null se il giorno non è tra i consigliati. */
export function recommendedHour(
  platform: Platform,
  weekday: number,
  slots: SlotMap = RECOMMENDED_SLOTS,
): number | null {
  return slots[platform].find((slot) => slot.weekday === weekday)?.hour ?? null;
}

const WEEKDAY_NAMES = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

/** "mar, mer, gio 08:00" oppure "gio 18:00, sab 17:00": gli slot consigliati di una piattaforma. */
export function recommendedSlotsLabel(
  platform: Platform,
  map: SlotMap = RECOMMENDED_SLOTS,
): string {
  const slots = map[platform];
  if (slots.length === 0) return 'nessuno slot';
  const hours = new Set(slots.map((slot) => slot.hour));
  if (hours.size === 1) {
    return `${slots.map((s) => WEEKDAY_NAMES[s.weekday]).join(', ')} ${pad2(slots[0]!.hour)}:00`;
  }
  return slots.map((s) => `${WEEKDAY_NAMES[s.weekday]} ${pad2(s.hour)}:00`).join(', ');
}

export function recommendedPlatforms(
  weekday: number,
  hour: number,
  visible: ReadonlySet<Platform>,
  slots: SlotMap = RECOMMENDED_SLOTS,
): Platform[] {
  return PLATFORMS.filter(
    (p) =>
      visible.has(p) && slots[p].some((slot) => slot.weekday === weekday && slot.hour === hour),
  );
}

/** Pubblicazioni che occupano il calendario: le annullate escono di scena. */
export function activePublications(publications: readonly PublicationView[]): PublicationView[] {
  return publications.filter((p) => p.status !== 'annullato');
}

export interface PlacedPublication {
  publication: PublicationView;
  day: DayKey;
  hour: number;
  time: string;
}

export function placePublications(
  publications: readonly PublicationView[],
  visible: ReadonlySet<Platform>,
): PlacedPublication[] {
  return activePublications(publications)
    .filter((p) => visible.has(p.platform))
    .map((publication) => {
      const parts = zonedParts(new Date(publication.scheduledAt));
      return {
        publication,
        day: parts.day,
        hour: parts.hour,
        time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
      };
    })
    .sort((a, b) => a.publication.scheduledAt.localeCompare(b.publication.scheduledAt));
}

/** Righe orarie della settimana: 8-21 come nel mockup, allargate se ci sono uscite fuori fascia. */
export function hourRange(placed: readonly PlacedPublication[], days: readonly DayKey[]): number[] {
  const inWeek = placed.filter((p) => days.includes(p.day)).map((p) => p.hour);
  const from = Math.min(8, ...inWeek);
  const to = Math.max(21, ...inWeek);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Uno slot è nel passato quando la sua ora è già finita: lì non si può trascinare. */
export function isPastSlot(day: DayKey, hour: number, now: Date): boolean {
  return zonedToUtc(day, hour + 1).getTime() <= now.getTime();
}

export function slotInstant(day: DayKey, hour: number): string {
  return zonedToUtc(day, hour).toISOString();
}

/** Le pubblicazioni si spostano solo finché sono programmate (non in invio, pubblicate o in errore). */
export function isMovable(publication: PublicationView): boolean {
  return publication.status === 'programmato';
}

export interface UnscheduledItem {
  variant: Variant;
  contentTitle: string;
  /** Solo le variant approvate si possono programmare (regola fondamentale). */
  draggable: boolean;
}

const UNSCHEDULED_STATUSES: readonly VariantStatus[] = ['bozza', 'da_approvare', 'approvato'];

/** Variant senza orario: approvate prima (si possono trascinare), poi quelle ancora da approvare. */
export function unscheduledItems(contents: readonly Content[]): UnscheduledItem[] {
  return contents
    .flatMap((content) =>
      content.variants
        .filter((variant) => UNSCHEDULED_STATUSES.includes(variant.status))
        .map((variant) => ({
          variant,
          contentTitle: content.title,
          draggable: variant.status === 'approvato',
        })),
    )
    .sort((a, b) => Number(b.draggable) - Number(a.draggable));
}

const dayFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const monthFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

function asUtcDate(day: DayKey): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "16 – 22 novembre 2026", "30 novembre – 6 dicembre 2026", "Novembre 2026". */
export function rangeLabel(view: CalendarView, anchor: DayKey, weekStart: DayKey): string {
  if (view === 'month') {
    const label = monthFormatter.format(asUtcDate(anchor));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const end = addDays(weekStart, 6);
  const [startMonth, endMonth] = [weekStart.slice(0, 7), end.slice(0, 7)];
  const fmt = (day: DayKey, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', ...opts }).format(asUtcDate(day));
  if (startMonth === endMonth) {
    return `${fmt(weekStart, { day: 'numeric' })} – ${fmt(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  return `${fmt(weekStart, { day: 'numeric', month: 'long' })} – ${fmt(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** "dom 22 nov · 17:00": giorno e ora in Italia. */
export function whenLabel(iso: string): string {
  const parts = zonedParts(new Date(iso));
  const day = dayFormatter.format(asUtcDate(parts.day)).replace(/\./g, '');
  return `${day} · ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export interface PlanningRow {
  variant: Variant;
  publication: PublicationView | null;
  when: string;
  recommendation: string;
  status: VariantStatus | PublicationStatus;
}

/**
 * Pannello "Pianificazione multipiattaforma": per ogni variant del contenuto, quando esce,
 * se l'orario è quello consigliato e in che stato è.
 */
export function planningRows(
  content: Content,
  publications: readonly PublicationView[],
  slots: SlotMap = RECOMMENDED_SLOTS,
): PlanningRow[] {
  const active = activePublications(publications);
  return [...content.variants]
    .sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform))
    .map((variant) => {
      const publication =
        active
          .filter((p) => p.variantId === variant.id)
          .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0] ?? null;
      if (!publication) {
        return {
          variant,
          publication,
          when: 'da pianificare',
          recommendation: `consigliato: ${recommendedSlotsLabel(variant.platform, slots)}`,
          status: variant.status,
        };
      }
      const parts = zonedParts(new Date(publication.scheduledAt));
      const best = recommendedHour(variant.platform, parts.weekday, slots);
      const recommendation =
        best === null
          ? `giorno non consigliato · meglio ${recommendedSlotsLabel(variant.platform, slots)}`
          : parts.hour === best && parts.minute === 0
            ? 'orario consigliato'
            : `consigliato: ${pad2(best)}:00`;
      return {
        variant,
        publication,
        when: whenLabel(publication.scheduledAt),
        recommendation,
        status: publication.status,
      };
    });
}

/**
 * Nuovi orari per "Usa orari consigliati": stessa giornata, ora consigliata, solo nel futuro.
 * In un giorno senza slot consigliato per quella piattaforma l'uscita resta dov'è.
 */
export function recommendedMoves(
  rows: readonly PlanningRow[],
  now: Date,
  slots: SlotMap = RECOMMENDED_SLOTS,
): Array<{ publicationId: number; scheduledAt: string }> {
  return rows.flatMap((row) => {
    if (!row.publication || !isMovable(row.publication)) return [];
    const parts = zonedParts(new Date(row.publication.scheduledAt));
    const hour = recommendedHour(row.variant.platform, parts.weekday, slots);
    if (hour === null) return [];
    const target = zonedToUtc(parts.day, hour);
    if (target.getTime() <= now.getTime()) return [];
    if (target.toISOString() === new Date(row.publication.scheduledAt).toISOString()) return [];
    return [{ publicationId: row.publication.id, scheduledAt: target.toISOString() }];
  });
}

export interface MonthCell {
  day: DayKey;
  number: number;
  inMonth: boolean;
  pills: PlacedPublication[];
  more: number;
}

export function monthCells(anchor: DayKey, placed: readonly PlacedPublication[]): MonthCell[] {
  const month = anchor.slice(0, 7);
  return monthGrid(anchor).map((day) => {
    const all = placed.filter((p) => p.day === day);
    return {
      day,
      number: Number(day.slice(8)),
      inMonth: day.startsWith(month),
      pills: all.slice(0, 3),
      more: Math.max(0, all.length - 3),
    };
  });
}

export function weekColumns(
  weekStart: DayKey,
): Array<{ day: DayKey; name: string; number: number }> {
  return weekDays(weekStart).map((day) => ({
    day,
    name: new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'short' })
      .format(asUtcDate(day))
      .replace('.', ''),
    number: Number(day.slice(8)),
  }));
}

export const LEGEND: Array<VariantStatus> = [
  'bozza',
  'da_approvare',
  'approvato',
  'programmato',
  'pubblicato',
  'errore',
];

export function statusShort(status: VariantStatus | PublicationStatus): string {
  return STATUS_DISPLAY[status].short;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Da dove vengono gli slot consigliati, per la nota sotto il calendario: dai dati per le
 * piattaforme con abbastanza post misurati, predefiniti per le altre.
 */
export function slotsSourceNote(recommended: RecommendedSlots | undefined): string {
  const fromData = (recommended?.platforms ?? [])
    .filter((p) => p.source === 'dati')
    .map((p) => PLATFORM_LABELS[p.platform]);
  if (fromData.length === 0) {
    return 'Gli slot «consigliato» sono quelli predefiniti: diventano tuoi quando una piattaforma ha almeno 8 post con metriche.';
  }
  return `Slot «consigliato» calcolati dai tuoi post per ${fromData.join(', ')}; predefiniti per le altre piattaforme.`;
}
