import {
  DEFAULT_RECOMMENDED_SLOTS,
  PLATFORMS,
  type Platform,
  type PlatformSlots,
  type Slot,
} from '@prisma-app/shared';
import { postReach, type PostRow } from './aggregate.js';

/**
 * Slot consigliati dai dati (funzione pura). Per ogni piattaforma i post degli ultimi 90 giorni
 * con una misura di copertura (o visualizzazioni/impressioni) diventano un punteggio relativo:
 * valore / mediana della piattaforma, così un post andato bene pesa uguale su TikTok e su LinkedIn.
 * Poi l'ora migliore (media dei punteggi, almeno 2 post in quell'ora) e i 3 giorni migliori (almeno
 * 2 post ciascuno). Con meno di 8 post o senza ore e giorni ripetuti restano gli slot predefiniti:
 * con pochi dati un singolo post fortunato deciderebbe tutto.
 */

export const MIN_POSTS = 8;
const MIN_PER_GROUP = 2;
const BEST_DAYS = 3;

/** Giorno della settimana (0 = lunedì) e ora in Italia. */
export function romeSlot(date: Date): Slot {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
    parts.find((p) => p.type === 'weekday')!.value,
  );
  return { weekday, hour: Number(parts.find((p) => p.type === 'hour')!.value) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Gruppi con abbastanza post, dal punteggio medio più alto. */
function bestGroups(scored: Array<{ key: number; score: number }>): number[] {
  const groups = new Map<number, number[]>();
  for (const { key, score } of scored) groups.set(key, [...(groups.get(key) ?? []), score]);
  return [...groups.entries()]
    .filter(([, scores]) => scores.length >= MIN_PER_GROUP)
    .map(([key, scores]) => ({ key, mean: scores.reduce((a, b) => a + b, 0) / scores.length }))
    .sort((a, b) => b.mean - a.mean || a.key - b.key)
    .map((g) => g.key);
}

export function slotsFromPosts(platform: Platform, posts: readonly PostRow[]): PlatformSlots {
  const measured = posts
    .filter((p) => p.platform === platform)
    .flatMap((p) => {
      const value = postReach(p.metrics).value;
      return value === null ? [] : [{ slot: romeSlot(p.publishedAt), value }];
    });
  const fallback: PlatformSlots = {
    platform,
    slots: DEFAULT_RECOMMENDED_SLOTS[platform],
    source: 'predefinito',
    basedOn: measured.length,
  };
  if (measured.length < MIN_POSTS) return fallback;
  const mid = median(measured.map((m) => m.value)) || 1;
  const scored = measured.map((m) => ({ ...m, score: m.value / mid }));
  const [hour] = bestGroups(scored.map((s) => ({ key: s.slot.hour, score: s.score })));
  const days = bestGroups(scored.map((s) => ({ key: s.slot.weekday, score: s.score }))).slice(
    0,
    BEST_DAYS,
  );
  if (hour === undefined || days.length === 0) return fallback;
  return {
    platform,
    slots: [...days].sort((a, b) => a - b).map((weekday) => ({ weekday, hour })),
    source: 'dati',
    basedOn: measured.length,
  };
}

export function recommendedSlots(posts: readonly PostRow[]): PlatformSlots[] {
  return PLATFORMS.map((platform) => slotsFromPosts(platform, posts));
}
