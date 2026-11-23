import type { ToolsStatus } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  TOOL_NEEDS,
  fpsLabel,
  mediaUrl,
  missingTools,
  progressLabel,
  resolutionLabel,
  sizeLabel,
  transcriptSummary,
  videoTargets,
} from './video';

describe('etichette dei video', () => {
  it('riconosce le proporzioni comuni', () => {
    expect(resolutionLabel(1920, 1080)).toBe('1920×1080 · 16:9');
    expect(resolutionLabel(1080, 1920)).toBe('1080×1920 · 9:16');
    expect(resolutionLabel(1080, 1350)).toBe('1080×1350 · 4:5');
    expect(resolutionLabel(1000, 333)).toBe('1000×333');
  });

  it('scrive fps, dimensioni e indirizzo del media', () => {
    expect(fpsLabel(30)).toBe('30 fps');
    expect(fpsLabel(29.97)).toBe('29,97 fps');
    expect(sizeLabel(73_400_320)).toBe('70 MB');
    expect(sizeLabel(2.5 * 1024 ** 3)).toBe('2,5 GB');
    expect(mediaUrl('abc')).toBe('prisma-media://video/abc');
  });
});

describe('strumenti mancanti', () => {
  it('elenca quelli assenti o non funzionanti per una funzione', () => {
    const status: ToolsStatus = [
      { tool: 'ffmpeg', path: 'C:\\ffmpeg.exe', source: 'rilevato', detail: null, error: null },
      { tool: 'ffprobe', path: null, source: 'assente', detail: null, error: null },
      {
        tool: 'whisper',
        path: 'C:\\w.exe',
        source: 'impostato',
        detail: null,
        error: 'File non trovato',
      },
      { tool: 'whisperModel', path: null, source: 'assente', detail: null, error: null },
    ];
    expect(missingTools(status, TOOL_NEEDS.import)).toEqual(['ffprobe']);
    expect(missingTools(status, TOOL_NEEDS.transcribe)).toEqual(['whisper.cpp', 'Modello Whisper']);
    expect(missingTools(status, TOOL_NEEDS.render)).toEqual([]);
  });
});

describe('trascrizione', () => {
  it('riassume parole, frasi, silenzi e parole incerte', () => {
    const word = (text: string, startMs: number, endMs: number, p = 0.9) => ({
      text,
      startMs,
      endMs,
      p,
    });
    const transcript = {
      language: 'it',
      model: 'ggml-small.bin',
      createdAt: '2026-11-22T12:00:00.000Z',
      words: [
        word('Allora,', 2000, 2400),
        word('vediamo.', 2450, 2900, 0.3),
        word('Fine.', 5000, 5400),
      ],
    };
    expect(transcriptSummary(transcript, 7000)).toEqual({
      words: 3,
      sentences: 2,
      silences: 3,
      silenceLabel: '0:06',
      uncertain: 1,
    });
  });

  it('descrive l’avanzamento', () => {
    expect(progressLabel(null)).toBe('Avvio…');
    expect(progressLabel({ projectId: 'x', stage: 'trascrizione', percent: 45 })).toBe(
      'Trascrivo con Whisper · 45%',
    );
    expect(progressLabel({ projectId: 'x', stage: 'audio', percent: null })).toBe(
      'Estraggo l’audio',
    );
  });
});

describe('bozze per il video', () => {
  it('propone solo le variant delle piattaforme video', () => {
    const variant = (id: number, platform: string) => ({ id, platform }) as never;
    const contents = [
      {
        id: 1,
        title: 'Client DB',
        variants: [variant(1, 'youtube'), variant(2, 'blog'), variant(3, 'instagram')],
      },
    ] as never;
    expect(videoTargets(contents).map((t) => t.label)).toEqual([
      'Client DB · YouTube',
      'Client DB · Instagram',
    ]);
  });
});
