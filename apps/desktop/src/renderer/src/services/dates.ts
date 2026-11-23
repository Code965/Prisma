/** Fuso dell'interfaccia: tutte le date si mostrano in ora italiana (nel DB sono in UTC). */
export const UI_TIME_ZONE = 'Europe/Rome';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Giorno di calendario nel fuso dell'interfaccia, come numero confrontabile. */
function calendarDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return Date.parse(`${parts}T00:00:00Z`) / DAY_MS;
}

/**
 * "oggi", "ieri", "3 giorni fa", "1 settimana fa", "2 settimane fa"; oltre un mese la data
 * ("12 ott"). Si contano i giorni di calendario in ora italiana, non le 24 ore.
 */
export function relativeDay(iso: string, now: Date, timeZone = UI_TIME_ZONE): string {
  const date = new Date(iso);
  const days = calendarDay(now, timeZone) - calendarDay(date, timeZone);
  if (days <= 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 settimana fa' : `${weeks} settimane fa`;
  return new Intl.DateTimeFormat('it-IT', { timeZone, day: 'numeric', month: 'short' })
    .format(date)
    .replace('.', '');
}
