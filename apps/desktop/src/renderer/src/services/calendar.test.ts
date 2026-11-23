import type { Content, PublicationView, Variant } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  hourRange,
  isPastSlot,
  monthCells,
  placePublications,
  planningRows,
  rangeLabel,
  recommendedMoves,
  recommendedPlatforms,
  slotInstant,
  unscheduledItems,
  whenLabel,
} from './calendar';

const ALL = new Set(['linkedin', 'instagram', 'tiktok', 'youtube'] as const);

function variant(id: number, platform: Variant['platform'], status: Variant['status']): Variant {
  return {
    id,
    contentId: 1,
    platform,
    format: platform === 'youtube' ? 'video' : 'post',
    body: 'x',
    metadata: { hashtags: [] },
    status,
    version: 1,
    approvedAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  };
}

function publication(
  id: number,
  variantId: number,
  platform: Variant['platform'],
  scheduledAt: string,
  status: PublicationView['status'] = 'programmato',
): PublicationView {
  return {
    id,
    variantId,
    socialAccountId: 1,
    scheduledAt,
    status,
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: scheduledAt,
    externalId: null,
    externalUrl: null,
    lastError: null,
    publishedAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    platform,
    format: 'post',
    contentId: 1,
    contentTitle: 'Client database',
  };
}

describe('calendario', () => {
  it('colloca le pubblicazioni nel giorno e nell’ora italiani, senza le annullate', () => {
    const placed = placePublications(
      [
        publication(1, 1, 'youtube', '2026-11-22T16:00:00.000Z'),
        publication(2, 2, 'linkedin', '2026-11-24T07:30:00.000Z'),
        publication(3, 3, 'linkedin', '2026-11-25T07:00:00.000Z', 'annullato'),
      ],
      ALL,
    );
    expect(placed.map((p) => [p.day, p.hour, p.time])).toEqual([
      ['2026-11-22', 17, '17:00'],
      ['2026-11-24', 8, '08:30'],
    ]);
  });

  it('filtra per piattaforma', () => {
    const placed = placePublications(
      [publication(1, 1, 'youtube', '2026-11-22T16:00:00.000Z')],
      new Set(['linkedin'] as const),
    );
    expect(placed).toHaveLength(0);
  });

  it('allarga la fascia oraria per le uscite fuori 8-21', () => {
    const placed = placePublications(
      [publication(1, 1, 'tiktok', '2026-11-21T22:30:00.000Z')],
      ALL,
    );
    const range = hourRange(placed, ['2026-11-21']);
    expect(range[0]).toBe(8);
    expect(range.at(-1)).toBe(23);
  });

  it('segnala gli slot passati e calcola l’istante di uno slot', () => {
    const now = new Date('2026-11-21T16:20:00Z'); // 17:20 in Italia
    expect(isPastSlot('2026-11-21', 16, now)).toBe(true);
    expect(isPastSlot('2026-11-21', 17, now)).toBe(false);
    expect(slotInstant('2026-11-22', 17)).toBe('2026-11-22T16:00:00.000Z');
  });

  it('mostra gli slot consigliati delle piattaforme visibili', () => {
    expect(recommendedPlatforms(1, 8, ALL)).toEqual(['linkedin']);
    expect(recommendedPlatforms(1, 8, new Set(['youtube'] as const))).toEqual([]);
  });

  it('mette prima le variant approvate, le uniche trascinabili', () => {
    const content = {
      id: 1,
      title: 'C',
      variants: [
        variant(1, 'linkedin', 'bozza'),
        variant(2, 'youtube', 'approvato'),
        variant(3, 'tiktok', 'programmato'),
      ],
    } as Content;
    expect(unscheduledItems([content]).map((u) => [u.variant.id, u.draggable])).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it('etichetta periodi e orari in italiano', () => {
    expect(rangeLabel('week', '2026-11-22', '2026-11-16')).toBe('16 – 22 novembre 2026');
    expect(rangeLabel('week', '2026-12-01', '2026-11-30')).toBe('30 novembre – 6 dicembre 2026');
    expect(rangeLabel('month', '2026-11-22', '2026-11-16')).toBe('Novembre 2026');
    expect(whenLabel('2026-11-22T16:00:00.000Z')).toBe('dom 22 nov · 17:00');
  });

  it('descrive la pianificazione multipiattaforma e propone gli orari consigliati', () => {
    const content = {
      id: 1,
      title: 'C',
      variants: [variant(1, 'youtube', 'programmato'), variant(2, 'linkedin', 'approvato')],
    } as Content;
    // Domenica 22 alle 19:00: per YouTube la domenica il consigliato è alle 17.
    const pubs = [publication(10, 1, 'youtube', '2026-11-22T18:00:00.000Z')];
    const rows = planningRows(content, pubs);
    expect(rows.map((r) => [r.variant.platform, r.when, r.recommendation, r.status])).toEqual([
      ['linkedin', 'da pianificare', 'consigliato: mar, mer, gio 08:00', 'approvato'],
      ['youtube', 'dom 22 nov · 19:00', 'consigliato: 17:00', 'programmato'],
    ]);
    expect(recommendedMoves(rows, new Date('2026-11-21T10:00:00Z'))).toEqual([
      { publicationId: 10, scheduledAt: '2026-11-22T16:00:00.000Z' },
    ]);
    // Se l'orario consigliato è già passato non si sposta nulla.
    expect(recommendedMoves(rows, new Date('2026-11-22T16:30:00Z'))).toEqual([]);
  });

  it('riempie la griglia del mese con al massimo tre uscite per giorno', () => {
    const pubs = [9, 10, 11, 12].map((h, i) =>
      publication(i, i, 'linkedin', `2026-11-24T${String(h).padStart(2, '0')}:00:00.000Z`),
    );
    const cell = monthCells('2026-11-22', placePublications(pubs, ALL)).find(
      (c) => c.day === '2026-11-24',
    )!;
    expect(cell.pills).toHaveLength(3);
    expect(cell.more).toBe(1);
    expect(cell.inMonth).toBe(true);
  });

  it('non sposta un’uscita in un giorno senza slot consigliato per la piattaforma', () => {
    const content = {
      id: 1,
      title: 'C',
      variants: [variant(1, 'linkedin', 'programmato')],
    } as Content;
    // Domenica: LinkedIn non ha slot consigliati.
    const rows = planningRows(content, [
      publication(10, 1, 'linkedin', '2026-11-22T17:00:00.000Z'),
    ]);
    expect(rows[0]!.recommendation).toBe('giorno non consigliato · meglio mar, mer, gio 08:00');
    expect(recommendedMoves(rows, new Date('2026-11-21T10:00:00Z'))).toEqual([]);
  });
});
