import { describe, expect, it } from 'vitest';
import {
  VideoScriptRequestSchema,
  countWords,
  estimatedSeconds,
  alignScriptWords,
  estimatedWords,
  speechText,
} from './video-script.js';

describe('«Crea video dall’idea»', () => {
  it('accetta un’idea o una bozza, non entrambe', () => {
    expect(VideoScriptRequestSchema.safeParse({ ideaId: 3 }).success).toBe(true);
    expect(VideoScriptRequestSchema.safeParse({ variantId: 3 }).success).toBe(true);
    expect(VideoScriptRequestSchema.safeParse({ ideaId: 3, variantId: 4 }).success).toBe(false);
  });

  it('conta le parole e stima la durata letta', () => {
    expect(countWords('Il bug — in produzione!')).toBe(4);
    const narration = Array.from({ length: 24 }, () => 'parola').join(' ');
    expect(estimatedSeconds([{ narration }, { narration }])).toBe(20);
  });

  it('prepara il testo per la voce', () => {
    expect(speechText('Perché l’API “funziona” — al 100% & più… 🚀')).toBe(
      'Perché l\'API "funziona", al 100 per cento e più...',
    );
    expect(speechText('Ångström naïve Ýes')).toBe('Angstrom naive Yes');
  });

  it('stima i tempi delle parole scena per scena', () => {
    const words = estimatedWords([
      { narration: 'Ciao a tutti', startMs: 0, speechMs: 1200 },
      { narration: 'Rust', startMs: 2000, speechMs: 500 },
    ]);
    expect(words.map((w) => w.text)).toEqual(['Ciao', 'a', 'tutti', 'Rust']);
    // Peso = lettere + 1: «Ciao» 5 su 13.
    expect(words[0]).toMatchObject({ startMs: 0, endMs: 462 });
    expect(words[1]).toMatchObject({ startMs: 462 });
    expect(words[2]!.endMs).toBe(1200);
    expect(words[3]).toMatchObject({ startMs: 2000, endMs: 2500 });
  });
});

describe('copione allineato ai tempi di whisper.cpp', () => {
  const heard = (list: Array<[string, number, number]>) =>
    list.map(([text, startMs, endMs]) => ({ text, startMs, endMs, p: 0.9 }));

  it('tiene il testo del copione dove whisper ha capito male', () => {
    const words = alignScriptWords(
      ['Il', 'bug', 'più', 'costoso?'],
      heard([
        ['Il', 0, 100],
        ['buco', 100, 400],
        ['più', 400, 600],
        ['costoso?', 600, 1000],
      ]),
    );
    expect(words.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ['Il', 0, 100],
      ['bug', 100, 400],
      ['più', 400, 600],
      ['costoso?', 600, 1000],
    ]);
  });

  it('parole sentite in più allungano la precedente, quelle mancanti dividono il tempo', () => {
    const extra = alignScriptWords(
      ['uso', 'Rust', 'nei', 'progetti'],
      heard([
        ['uso', 0, 200],
        ['Rust', 200, 400],
        ['in', 400, 500],
        ['e', 500, 600],
        ['progetti', 600, 900],
      ]),
    );
    expect(extra.map((w) => w.text)).toEqual(['uso', 'Rust', 'nei', 'progetti']);
    expect(extra[3]).toMatchObject({ startMs: 600, endMs: 900 });
    expect(extra[2]!.startMs).toBeGreaterThanOrEqual(400);

    const missing = alignScriptWords(
      ['a', 'b', 'c', 'd'],
      heard([
        ['a', 0, 100],
        ['d', 700, 800],
      ]),
    );
    expect(missing.map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 100],
      [100, 400],
      [400, 700],
      [700, 800],
    ]);
  });
});
