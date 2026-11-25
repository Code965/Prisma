import { DEFAULT_VIDEO_AUDIO } from './video-audio.js';
import { describe, expect, it } from 'vitest';
import { GenerateShortsRequestSchema, shortEdit, shortSegments } from './shorts.js';
import { DEFAULT_VIDEO_EDIT } from './video-edit.js';

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, p: 0.9 });

describe('shortSegments', () => {
  it('tiene solo le frasi parlate, con i tempi del sorgente', () => {
    const words = [
      w('Ciao', 100, 500),
      w('a', 550, 600),
      w('tutti.', 600, 1000),
      w('Oggi', 4000, 4400),
      w('codice.', 4400, 5000),
    ];
    expect(shortSegments(words, 6000)).toEqual([
      { startMs: 100, endMs: 1000, text: 'Ciao a tutti.' },
      { startMs: 4000, endMs: 5000, text: 'Oggi codice.' },
    ]);
  });
});

describe('shortEdit', () => {
  it('taglia fuori dal momento e conserva i tagli interni', () => {
    const parent = {
      ...DEFAULT_VIDEO_EDIT,
      format: '16:9' as const,
      cropOffset: 0.2,
      subtitles: 'box' as const,
      cuts: [
        { startMs: 1000, endMs: 2000 },
        { startMs: 12_000, endMs: 13_000 },
        { startMs: 50_000, endMs: 51_000 },
      ],
      zooms: [
        { startMs: 2000, endMs: 3000, scale: 1.08 },
        { startMs: 20_000, endMs: 22_000, scale: 1.18 },
      ],
      keywords: [21_000],
      hook: { text: 'Titolo del video lungo', durationMs: 2500 },
      audio: DEFAULT_VIDEO_AUDIO,
      overlays: [
        {
          id: 'a',
          kind: 'title' as const,
          title: 'Dentro',
          body: '',
          code: '',
          startMs: 15_000,
          endMs: 18_000,
        },
        {
          id: 'b',
          kind: 'title' as const,
          title: 'Fuori',
          body: '',
          code: '',
          startMs: 45_000,
          endMs: 48_000,
        },
      ],
      broll: [],
      followFace: false,
      layout: 'camera' as const,
    };
    expect(shortEdit(parent, 60_000, { startMs: 10_000, endMs: 40_000 })).toEqual({
      format: '9:16',
      cropOffset: 0.5,
      subtitles: 'box',
      cuts: [
        { startMs: 0, endMs: 10_000 },
        { startMs: 12_000, endMs: 13_000 },
        { startMs: 40_000, endMs: 60_000 },
      ],
      zooms: [{ startMs: 20_000, endMs: 22_000, scale: 1.18 }],
      keywords: [21_000],
      hook: null,
      audio: DEFAULT_VIDEO_AUDIO,
      overlays: [
        {
          id: 'a',
          kind: 'title',
          title: 'Dentro',
          body: '',
          code: '',
          startMs: 15_000,
          endMs: 18_000,
        },
      ],
      broll: [],
      followFace: false,
      layout: 'camera' as const,
    });
  });

  it('un momento che arriva ai bordi non aggiunge tagli vuoti', () => {
    const edit = shortEdit({ ...DEFAULT_VIDEO_EDIT, cropOffset: 0.3 }, 20_000, {
      startMs: 0,
      endMs: 20_000,
    });
    expect(edit.cuts).toEqual([]);
    expect(edit.cropOffset).toBe(0.3);
  });
});

describe('GenerateShortsRequestSchema', () => {
  it('rifiuta frasi con la fine prima dell’inizio e piattaforme non verticali', () => {
    const base = { brandId: 1, videoTitle: 'Video', durationMs: 60_000, platforms: ['youtube'] };
    expect(
      GenerateShortsRequestSchema.safeParse({
        ...base,
        segments: [{ startMs: 5, endMs: 1, text: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      GenerateShortsRequestSchema.safeParse({
        ...base,
        platforms: ['linkedin'],
        segments: [{ startMs: 0, endMs: 1, text: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      GenerateShortsRequestSchema.parse({
        ...base,
        segments: [{ startMs: 0, endMs: 1, text: 'x' }],
      }).count,
    ).toBe(3);
  });
});
