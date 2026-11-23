import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  monthGrid,
  startOfWeek,
  weekDays,
  zonedParts,
  zonedToUtc,
} from './zoned-time';

describe('orari in Europe/Rome', () => {
  it('converte l’ora italiana in UTC con e senza ora legale', () => {
    expect(zonedToUtc('2026-11-22', 17).toISOString()).toBe('2026-11-22T16:00:00.000Z');
    expect(zonedToUtc('2026-07-15', 8, 30).toISOString()).toBe('2026-07-15T06:30:00.000Z');
  });

  it('gestisce i giorni del cambio d’ora', () => {
    // 29 marzo 2026: alle 02:00 si va alle 03:00.
    expect(zonedToUtc('2026-03-29', 1).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(zonedToUtc('2026-03-29', 3).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // 25 ottobre 2026: si torna indietro alle 03:00.
    expect(zonedToUtc('2026-10-25', 12).toISOString()).toBe('2026-10-25T11:00:00.000Z');
  });

  it('scompone un istante nelle parti italiane', () => {
    expect(zonedParts(new Date('2026-11-22T23:30:00Z'))).toMatchObject({
      day: '2026-11-23',
      hour: 0,
      minute: 30,
      weekday: 0, // lunedì
    });
  });
});

describe('giorni del calendario', () => {
  it('trova il lunedì e i sette giorni della settimana', () => {
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16');
    expect(weekDays('2026-11-16')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });

  it('attraversa mesi e anni', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addMonths('2026-11-22', 1)).toBe('2026-12-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('costruisce la griglia mensile di 6 settimane dal lunedì', () => {
    const grid = monthGrid('2026-11-22');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-10-26');
    expect(grid).toContain('2026-11-30');
  });
});
