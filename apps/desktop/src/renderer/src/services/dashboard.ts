import type { Platform, WeekSummary } from '@prisma-app/shared';
import { compactNumber } from './analytics';
import type { PlacedPublication } from './calendar';
import { addDays, weekDays, zonedParts, type DayKey } from './zoned-time';

/** "Buongiorno" fino alle 13, "Buon pomeriggio" fino alle 18, poi "Buonasera" (ora italiana). */
export function greeting(now: Date, brandName: string | undefined): string {
  const hour = zonedParts(now).hour;
  const salute = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const firstName = brandName?.trim().split(/\s+/)[0];
  return firstName ? `${salute}, ${firstName}` : salute;
}

/** "sabato 21 novembre" */
export function longDate(now: Date): string {
  const day = zonedParts(now).day;
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** "16 – 22 novembre" (titolo della striscia settimanale). */
export function weekTitle(weekStart: DayKey): string {
  const end = addDays(weekStart, 6);
  const fmt = (day: DayKey, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', ...opts }).format(
      new Date(`${day}T00:00:00Z`),
    );
  return weekStart.slice(0, 7) === end.slice(0, 7)
    ? `${fmt(weekStart, { day: 'numeric' })} – ${fmt(end, { day: 'numeric', month: 'long' })}`
    : `${fmt(weekStart, { day: 'numeric', month: 'long' })} – ${fmt(end, { day: 'numeric', month: 'long' })}`;
}

export interface WeekStripDay {
  day: DayKey;
  label: string;
  isToday: boolean;
  /** Giorno già finito (prima di oggi): si mostra più spento. */
  isPast: boolean;
  isWeekend: boolean;
  /** Piattaforme delle uscite del giorno, senza doppioni, nell'ordine dell'orario: danno il colore. */
  platforms: Platform[];
  posts: PlacedPublication[];
}

/** Sette giorni con le uscite di ciascuno; il giorno corrente si chiama "oggi" come nel mockup. */
export function weekStrip(
  weekStart: DayKey,
  placed: readonly PlacedPublication[],
  now: Date,
): WeekStripDay[] {
  const today = zonedParts(now).day;
  return weekDays(weekStart).map((day, index) => {
    const posts = placed.filter((p) => p.day === day);
    const name = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'short' })
      .format(new Date(`${day}T00:00:00Z`))
      .replace('.', '');
    return {
      day,
      label: day === today ? 'oggi' : `${name} ${Number(day.slice(8))}`,
      isToday: day === today,
      isPast: day < today,
      // La settimana parte da lunedì: sabato e domenica sono gli ultimi due.
      isWeekend: index >= 5,
      platforms: [...new Set(posts.map((p) => p.publication.platform))],
      posts,
    };
  });
}

export interface WeekMetricCard {
  platform: Platform;
  /** «Follower» o «Iscritti» (YouTube). */
  what: string;
  value: string;
  /** Variazione dei 7 giorni («+42»), null se non calcolabile. */
  delta: { text: string; positive: boolean } | null;
  sub: string;
}

/** Riquadri «Ultimi 7 giorni» del mockup: follower, variazione e copertura della settimana. */
export function weekMetricCards(summary: WeekSummary | undefined): WeekMetricCard[] {
  return (summary?.platforms ?? []).map((p) => ({
    platform: p.platform,
    what: p.platform === 'youtube' ? 'Iscritti' : 'Follower',
    value: p.followers === null ? '—' : compactNumber(p.followers),
    delta:
      p.followersDelta === null
        ? null
        : {
            text: `${p.followersDelta >= 0 ? '+' : ''}${compactNumber(p.followersDelta)}`,
            positive: p.followersDelta >= 0,
          },
    sub:
      p.reach === null
        ? `nessun dato di ${p.reachLabel}`
        : `${compactNumber(p.reach, 1000)} ${p.reachLabel}`,
  }));
}
