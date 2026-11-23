import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from './transcript.js';
import {
  addCut,
  buildCaptions,
  captionAt,
  cropRect,
  editedDurationMs,
  editedTimeMs,
  isCut,
  keptRanges,
  normalizeRanges,
  removeCut,
  skipCuts,
  toggleCut,
} from './video-edit.js';

const r = (startMs: number, endMs: number) => ({ startMs, endMs });

describe('tagli', () => {
  it('fonde gli intervalli che si toccano', () => {
    expect(normalizeRanges([r(5, 8), r(0, 2), r(2, 4), r(7, 10)])).toEqual([r(0, 4), r(5, 10)]);
  });

  it('aggiunge, toglie anche a metà, e capisce se un tratto è tagliato', () => {
    const cuts = addCut([r(0, 1000)], r(3000, 5000));
    expect(cuts).toEqual([r(0, 1000), r(3000, 5000)]);
    expect(removeCut(cuts, r(3500, 4000))).toEqual([r(0, 1000), r(3000, 3500), r(4000, 5000)]);
    expect(isCut(cuts, r(3200, 4800))).toBe(true);
    expect(isCut(cuts, r(900, 1100))).toBe(false);
    expect(toggleCut(toggleCut([], r(10, 20)), r(10, 20))).toEqual([]);
  });

  it('calcola le parti rimaste, la durata e i tempi del video montato', () => {
    const cuts = [r(1000, 2000), r(5000, 6000)];
    expect(keptRanges(cuts, 8000)).toEqual([r(0, 1000), r(2000, 5000), r(6000, 8000)]);
    expect(editedDurationMs(cuts, 8000)).toBe(6000);
    expect(editedTimeMs(cuts, 5500)).toBe(4000);
    expect(editedTimeMs(cuts, 7000)).toBe(5000);
    expect(skipCuts(cuts, 1500)).toBe(2000);
    expect(skipCuts(cuts, 2500)).toBe(2500);
  });
});

describe('ritaglio', () => {
  it('da 16:9 a 9:16 ritaglia in larghezza seguendo la posizione', () => {
    expect(cropRect('9:16', 1920, 1080, 0.5)).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    expect(cropRect('9:16', 1920, 1080, 0)).toMatchObject({ x: 0 });
    expect(cropRect('9:16', 1920, 1080, 1)).toMatchObject({ x: 1312 });
    expect(cropRect('16:9', 1920, 1080, 0.3)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('da verticale a 16:9 ritaglia in altezza', () => {
    expect(cropRect('16:9', 1080, 1920, 0.5)).toEqual({ x: 0, y: 656, width: 1080, height: 608 });
    expect(cropRect('1:1', 1080, 1920, 0)).toEqual({ x: 0, y: 0, width: 1080, height: 1080 });
  });
});

describe('sottotitoli', () => {
  const w = (text: string, startMs: number, endMs: number): TranscriptWord => ({
    text,
    startMs,
    endMs,
    p: 0.9,
  });
  const words = [
    w('La', 0, 200),
    w('soluzione', 250, 700),
    w('è', 750, 850),
    w('una', 900, 1100),
    w('riga.', 1150, 1500),
    w('Aspetta,', 2000, 2400),
    w('riparto.', 2450, 2900),
    w('Fine', 4000, 4300),
  ];

  it('spezza alle frasi, alle pause e sulla lunghezza, e salta le parole tagliate', () => {
    const captions = buildCaptions(words, [r(1900, 3000)], 12);
    expect(captions.map((c) => c.words.map((x) => x.text).join(' '))).toEqual([
      'La soluzione',
      'è una riga.',
      'Fine',
    ]);
    expect(captions[1]).toMatchObject({ startMs: 750, endMs: 1500 });
  });

  it('trova la didascalia e la parola attiva a un istante', () => {
    const captions = buildCaptions(words, []);
    expect(captionAt(captions, 950)).toMatchObject({ activeWord: 3 });
    expect(captionAt(captions, 3500)).toBeNull();
  });
});
