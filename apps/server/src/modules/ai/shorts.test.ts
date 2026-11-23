import { describe, expect, it } from 'vitest';
import { formatSegments, generatedShortsSchema } from './shorts.js';

const segments = [
  { startMs: 0, endMs: 8_000, text: 'Introduzione.' },
  { startMs: 8_000, endMs: 20_000, text: 'Il problema delle query lente.' },
  { startMs: 20_000, endMs: 35_000, text: 'La soluzione con un indice.' },
  { startMs: 35_000, endMs: 200_000, text: 'Una parte lunghissima.' },
];
const variant = (platform: string) => ({ platform, body: 'testo', hashtags: ['#sql', 'db '] });
const moment = (firstSegment: number, lastSegment: number, platforms = ['youtube', 'tiktok']) => ({
  firstSegment,
  lastSegment,
  title: 'Indici',
  reason: 'Problema e soluzione in 27 secondi',
  variants: platforms.map(variant),
});

describe('generatedShortsSchema', () => {
  const schema = generatedShortsSchema(segments, ['youtube', 'tiktok'], 2);

  it('accetta momenti validi e normalizza gli hashtag', () => {
    const parsed = schema.parse({ shorts: [moment(1, 2)] });
    expect(parsed.shorts[0]!.variants[0]!.hashtags).toEqual(['#sql', '#db']);
  });

  it('rifiuta frasi inesistenti, durate fuori dai limiti, sovrapposizioni e piattaforme mancanti', () => {
    const messages = (value: unknown) => {
      const result = schema.safeParse(value);
      return result.success ? [] : result.error.issues.map((i) => i.message);
    };
    expect(messages({ shorts: [moment(2, 9)] })[0]).toMatch(/non valide/);
    expect(messages({ shorts: [moment(0, 0)] })[0]).toMatch(/dura 8 s/);
    expect(messages({ shorts: [moment(3, 3)] })[0]).toMatch(/dura 165 s/);
    expect(messages({ shorts: [moment(1, 2), moment(2, 2)] })).toContain(
      'Si sovrappone a un altro momento',
    );
    expect(messages({ shorts: [moment(1, 2, ['youtube'])] })[0]).toMatch(
      /Manca il testo per: tiktok/,
    );
    expect(messages({ shorts: [moment(1, 2), moment(0, 1), moment(2, 2)] }).length).toBeGreaterThan(
      0,
    );
  });

  it('numera le frasi con gli orari', () => {
    expect(formatSegments(segments.slice(1, 2))).toBe(
      '[0] 0:08–0:20 Il problema delle query lente.',
    );
  });
});
