import { UI_TIME_ZONE } from './dates';

/**
 * Date di calendario e orari nel fuso dell'interfaccia (Europe/Rome), senza librerie.
 * Un giorno è una stringa "YYYY-MM-DD": niente ambiguità di fuso nei confronti.
 */
export type DayKey = string;

export interface ZonedParts {
  day: DayKey;
  year: number;
  month: number; // 1-12
  date: number;
  hour: number;
  minute: number;
  /** 0 = lunedì … 6 = domenica, come nel mockup. */
  weekday: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

const partsFormatter = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
}

function rawParts(date: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

export function zonedParts(date: Date, timeZone = UI_TIME_ZONE): ZonedParts {
  const p = rawParts(date, timeZone);
  const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return {
    day,
    year: p.year,
    month: p.month,
    date: p.day,
    hour: p.hour,
    minute: p.minute,
    weekday: (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7,
  };
}

/** Scarto in millisecondi tra l'ora locale del fuso e UTC in quell'istante. */
function offsetMs(date: Date, timeZone: string): number {
  const p = rawParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Istante UTC di un orario "da muro" nel fuso (es. 22 novembre ore 17:00 a Roma).
 * Due passaggi gestiscono i cambi d'ora legale; un orario inesistente (le 02:30 del giorno
 * in cui si va avanti) viene spostato in avanti dell'ora mancante.
 */
export function zonedToUtc(day: DayKey, hour: number, minute = 0, timeZone = UI_TIME_ZONE): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const first = wall - offsetMs(new Date(wall), timeZone);
  const second = wall - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

export function addDays(day: DayKey, days: number): DayKey {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Lunedì della settimana che contiene il giorno. */
export function startOfWeek(day: DayKey): DayKey {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function weekDays(weekStart: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function addMonths(day: DayKey, months: number): DayKey {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  return target.toISOString().slice(0, 10);
}

/** Le 6 settimane (42 giorni) della griglia mensile, dal lunedì prima del giorno 1. */
export function monthGrid(day: DayKey): DayKey[] {
  const first = `${day.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
