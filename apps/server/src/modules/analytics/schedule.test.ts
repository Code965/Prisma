import { describe, expect, it } from 'vitest';
import { accountMetricsDue, accountRange, postMetricsDue } from './schedule.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date('2026-11-22T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('quando aggiornare le metriche', () => {
  it('post: ogni giorno nella prima settimana, poi ogni settimana fino a 90 giorni', () => {
    expect(postMetricsDue(ago(2 * DAY), null, now)).toBe(true);
    expect(postMetricsDue(ago(2 * DAY), ago(12 * HOUR), now)).toBe(false);
    expect(postMetricsDue(ago(2 * DAY), ago(23 * HOUR), now)).toBe(true);
    expect(postMetricsDue(ago(20 * DAY), ago(3 * DAY), now)).toBe(false);
    expect(postMetricsDue(ago(20 * DAY), ago(7 * DAY), now)).toBe(true);
    expect(postMetricsDue(ago(91 * DAY), ago(30 * DAY), now)).toBe(false);
  });

  it('un post mai misurato si smette di cercarlo dopo 14 giorni', () => {
    expect(postMetricsDue(ago(13 * DAY), null, now)).toBe(true);
    expect(postMetricsDue(ago(15 * DAY), null, now)).toBe(false);
  });

  it('account: una volta al giorno, ripassando gli ultimi 3 giorni', () => {
    expect(accountMetricsDue(null, now)).toBe(true);
    expect(accountMetricsDue(ago(10 * HOUR), now)).toBe(false);
    expect(accountMetricsDue(ago(21 * HOUR), now)).toBe(true);
    expect(accountRange(null, now)).toEqual({ fromDay: '2026-10-25', toDay: '2026-11-22' });
    expect(accountRange('2026-11-21', now)).toEqual({ fromDay: '2026-11-18', toDay: '2026-11-22' });
    expect(accountRange('2026-01-01', now).fromDay).toBe('2026-10-25');
  });
});
