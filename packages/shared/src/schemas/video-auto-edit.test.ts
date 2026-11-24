import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from './transcript.js';
import {
  applyAutoEdit,
  autoEditSegments,
  isHesitation,
  matchSegmentWords,
  type AutoEditPlan,
} from './video-auto-edit.js';
import { DEFAULT_VIDEO_EDIT, isCut, zoomAt, zoomedParts } from './video-edit.js';

const word = (text: string, startMs: number, endMs = startMs + 300): TranscriptWord => ({
  text,
  startMs,
  endMs,
  p: 0.9,
});

// Frase 0: «Ciao, ehm, oggi parlo di Rust.» · pausa di 2 s · frase 1: «Cioè, Rust è velocissimo.»
const WORDS: TranscriptWord[] = [
  word('Ciao,', 0),
  word('ehm,', 400),
  word('oggi', 800),
  word('parlo', 1200),
  word('di', 1600),
  word('Rust.', 2000),
  word('Cioè,', 4400),
  word('Rust', 4800),
  word('è', 5200),
  word('velocissimo.', 5600),
];
const DURATION = 7000;

const plan = (patch: Partial<AutoEditPlan>): AutoEditPlan => ({
  removeSegments: [],
  fillers: [],
  keywords: [],
  emphasis: [],
  hook: null,
  ...patch,
});

describe('«Monta con l’AI»', () => {
  it('riconosce le esitazioni ma non le parole vere', () => {
    expect(['ehm,', 'Uhm', 'mmh', 'ehh…'].every(isHesitation)).toBe(true);
    expect(['e', 'hem', 'mamma', 'cioè'].some(isHesitation)).toBe(false);
  });

  it('trova le parole indicate dal modello dentro la frase, senza punteggiatura', () => {
    const [first, second] = autoEditSegments(WORDS, DURATION);
    expect(matchSegmentWords(WORDS, first!, ['rust'])).toEqual([5]);
    expect(matchSegmentWords(WORDS, second!, ['cioè', 'Rust'])).toEqual([6, 7]);
  });

  it('taglia silenzi, esitazioni e riempitivi, evidenzia le parole chiave e mette hook e zoom', () => {
    const { edit, summary } = applyAutoEdit(
      DEFAULT_VIDEO_EDIT,
      WORDS,
      DURATION,
      plan({
        fillers: [{ segment: 1, words: ['cioè'] }],
        keywords: [{ segment: 1, words: ['velocissimo', 'Rust'] }],
        emphasis: [1],
        hook: { text: 'Rust è velocissimo', segment: 1 },
      }),
    );
    expect(summary).toMatchObject({ hesitations: 1, fillers: 1, keywords: 2, hook: true });
    expect(summary.silences).toBeGreaterThan(0);
    expect(isCut(edit.cuts, { startMs: 400, endMs: 700 })).toBe(true); // «ehm»
    expect(isCut(edit.cuts, { startMs: 4400, endMs: 4700 })).toBe(true); // «Cioè»
    expect(isCut(edit.cuts, { startMs: 2400, endMs: 4300 })).toBe(true); // silenzio
    expect(edit.keywords).toEqual([4800, 5600]);
    expect(edit.hook).toEqual({ text: 'Rust è velocissimo', durationMs: 2500 });
    expect(zoomAt(edit.zooms, 5300)).toBe(1.18); // frase importante
    expect(summary.removedMs).toBeGreaterThan(2000);
  });

  it('toglie le frasi indicate e ignora numeri di frase inesistenti', () => {
    const { edit, summary } = applyAutoEdit(
      DEFAULT_VIDEO_EDIT,
      WORDS,
      DURATION,
      plan({
        removeSegments: [
          { segment: 0, reason: 'falsa partenza' },
          { segment: 9, reason: 'x' },
        ],
      }),
    );
    expect(summary.removedSegments).toBe(1);
    expect(isCut(edit.cuts, { startMs: 0, endMs: 2300 })).toBe(true);
  });

  it('toglie i pezzi rimasti troppo corti tra due tagli', () => {
    const words = [word('Allora.', 100, 900), word('Rust', 3000, 3400), word('vola.', 3400, 3800)];
    const { edit } = applyAutoEdit(
      DEFAULT_VIDEO_EDIT,
      words,
      4000,
      plan({ removeSegments: [{ segment: 0, reason: 'falsa partenza' }] }),
    );
    // I primi 100 ms prima di «Allora» non restano come un lampo all'inizio.
    expect(isCut(edit.cuts, { startMs: 0, endMs: 100 })).toBe(true);
  });

  it('divide le parti rimaste dove cambia lo zoom', () => {
    const parts = zoomedParts(
      [
        { startMs: 0, endMs: 1000 },
        { startMs: 2000, endMs: 3000 },
      ],
      [{ startMs: 500, endMs: 2500, scale: 1.2 }],
    );
    expect(parts).toEqual([
      { startMs: 0, endMs: 500, scale: 1 },
      { startMs: 500, endMs: 1000, scale: 1.2 },
      { startMs: 2000, endMs: 2500, scale: 1.2 },
      { startMs: 2500, endMs: 3000, scale: 1 },
    ]);
  });
});
