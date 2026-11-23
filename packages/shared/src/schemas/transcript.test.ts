import { describe, expect, it } from 'vitest';
import { transcriptSegments, type TranscriptWord } from './transcript.js';

const w = (text: string, startMs: number, endMs: number): TranscriptWord => ({
  text,
  startMs,
  endMs,
  p: 0.9,
});

describe('segmenti della trascrizione', () => {
  it('divide in frasi alla punteggiatura e separa i silenzi lunghi', () => {
    const words = [
      w('Allora,', 1500, 1900),
      w('vediamo.', 1950, 2400),
      w('Con', 2500, 2700),
      w('Avalonia', 2750, 3300),
      w('la', 5000, 5100),
      w('UI.', 5150, 5600),
    ];
    expect(transcriptSegments(words, 9000)).toEqual([
      { kind: 'silence', startMs: 0, endMs: 1500 },
      {
        kind: 'speech',
        firstWord: 0,
        lastWord: 1,
        startMs: 1500,
        endMs: 2400,
        text: 'Allora, vediamo.',
      },
      {
        kind: 'speech',
        firstWord: 2,
        lastWord: 3,
        startMs: 2500,
        endMs: 3300,
        text: 'Con Avalonia',
      },
      { kind: 'silence', startMs: 3300, endMs: 5000 },
      { kind: 'speech', firstWord: 4, lastWord: 5, startMs: 5000, endMs: 5600, text: 'la UI.' },
      { kind: 'silence', startMs: 5600, endMs: 9000 },
    ]);
  });

  it('una pausa media chiude la frase ma non diventa un silenzio', () => {
    const segments = transcriptSegments([w('uno', 0, 300), w('due', 1000, 1300)], 1300);
    expect(segments.map((s) => s.kind)).toEqual(['speech', 'speech']);
  });

  it('senza parole tutto il video è silenzio', () => {
    expect(transcriptSegments([], 4000)).toEqual([{ kind: 'silence', startMs: 0, endMs: 4000 }]);
    expect(transcriptSegments([], 500)).toEqual([]);
  });
});
