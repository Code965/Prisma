/**
 * Quando aggiornare le metriche (funzioni pure). I numeri dei post crescono soprattutto nei
 * primi giorni: ogni giorno nella prima settimana, poi ogni settimana fino a 90 giorni.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const METRICS_WINDOW_DAYS = 90;
/** Un post mai misurato (TikTok non ancora pubblico) si smette di cercarlo dopo 14 giorni. */
export const METRICS_GIVE_UP_DAYS = 14;

export function postMetricsDue(publishedAt: Date, lastCapturedAt: Date | null, now: Date): boolean {
  const age = now.getTime() - publishedAt.getTime();
  if (age < 0 || age > METRICS_WINDOW_DAYS * DAY) return false;
  if (!lastCapturedAt) return age <= METRICS_GIVE_UP_DAYS * DAY;
  // Un'ora di tolleranza: il ciclo orario non deve slittare di un giorno.
  const interval = age < 7 * DAY ? DAY - HOUR : 7 * DAY - HOUR;
  return now.getTime() - lastCapturedAt.getTime() >= interval;
}

/** Gli account si aggiornano una volta al giorno. */
export function accountMetricsDue(lastCapturedAt: Date | null, now: Date): boolean {
  return !lastCapturedAt || now.getTime() - lastCapturedAt.getTime() >= 20 * HOUR;
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Giorni da chiedere per un account: dall'ultimo salvato meno 3 (le piattaforme completano i
 * dati con 2-3 giorni di ritardo, i valori si sovrascrivono) fino a oggi; la prima volta 28.
 */
export function accountRange(
  lastDay: string | null,
  now: Date,
): { fromDay: string; toDay: string } {
  const toDay = dayString(now);
  const first = new Date(now.getTime() - 28 * DAY);
  if (!lastDay) return { fromDay: dayString(first), toDay };
  const from = new Date(new Date(`${lastDay}T00:00:00Z`).getTime() - 3 * DAY);
  return { fromDay: dayString(from < first ? first : from), toDay };
}
