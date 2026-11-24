import { DEFAULT_VIDEO_EDIT, type Content, type VideoProject } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { shortsRequest, shortsToast, suggestedTarget } from './shorts';
import type { VideoTarget } from './video';

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, p: 0.9 });

const project = (transcript: VideoProject['transcript']): VideoProject => ({
  id: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
  title: 'Client database',
  source: {
    path: 'C:\v.mp4',
    fileName: 'v.mp4',
    sizeBytes: 1,
    durationMs: 120_000,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    hasAudio: true,
  },
  transcript,
  edit: { ...DEFAULT_VIDEO_EDIT, cuts: [{ startMs: 0, endMs: 5000 }] },
  render: null,
  short: null,
  generated: null,
  filmcraft: null,
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
});

describe('shortsRequest', () => {
  it('manda le frasi con i tempi del sorgente, ignorando i tagli', () => {
    const transcript = {
      language: 'it',
      model: 'ggml-small.bin',
      createdAt: '2026-11-22T10:00:00.000Z',
      words: [w('Ciao.', 1000, 1500), w('Indici.', 70_000, 71_000)],
    };
    expect(shortsRequest(project(transcript), 3)).toEqual({
      brandId: 3,
      videoTitle: 'Client database',
      durationMs: 120_000,
      segments: [
        { startMs: 1000, endMs: 1500, text: 'Ciao.' },
        { startMs: 70_000, endMs: 71_000, text: 'Indici.' },
      ],
      platforms: ['youtube', 'tiktok', 'instagram'],
    });
  });

  it('senza trascrizione o senza parlato non c’è richiesta', () => {
    expect(shortsRequest(project(null), 1)).toBeNull();
    expect(
      shortsRequest(
        project({ language: 'it', model: 'm', createdAt: '2026-11-22T10:00:00.000Z', words: [] }),
        1,
      ),
    ).toBeNull();
  });
});

describe('shortsToast', () => {
  it('elenca gli orari d’inizio', () => {
    expect(shortsToast([{ startMs: 72_000 }, { startMs: 270_000 }, { startMs: 782_000 }])).toBe(
      'Trovati 3 momenti per gli Short: 1:12, 4:30, 13:02. Li trovi nello Studio e tra i video, pronti da rivedere.',
    );
    expect(shortsToast([{ startMs: 0 }])).toMatch(/^Trovato 1 momento/);
  });
});

describe('suggestedTarget', () => {
  it('propone una bozza del contenuto dello Short', () => {
    const target = (contentId: number, variantId: number) =>
      ({
        content: { id: contentId } as Content,
        variant: { id: variantId },
        label: '',
      }) as VideoTarget;
    const targets = [target(1, 10), target(7, 70), target(7, 71)];
    const short = {
      parentId: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
      contentId: 7,
      startMs: 0,
      endMs: 1,
    };
    expect(suggestedTarget({ short }, targets)?.variant.id).toBe(70);
    expect(suggestedTarget({ short: null }, targets)).toBeNull();
  });
});
