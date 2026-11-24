import type { VideoProject } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { autoEditRequest, autoEditToast, zoomedOverlay } from './auto-edit';

const summary = {
  silences: 3,
  hesitations: 1,
  fillers: 2,
  removedSegments: 0,
  keywords: 5,
  zooms: 4,
  hook: true,
  removedMs: 4200,
};

describe('«Monta con l’AI» nell’editor', () => {
  it('manda al server solo le frasi parlate', () => {
    const project = {
      title: 'Perché Rust',
      source: { durationMs: 5000 },
      transcript: {
        words: [
          { text: 'Ciao.', startMs: 0, endMs: 400, p: 1 },
          { text: 'Rust.', startMs: 2000, endMs: 2400, p: 1 },
        ],
      },
    } as unknown as VideoProject;
    expect(autoEditRequest(project, 7)).toEqual({
      brandId: 7,
      videoTitle: 'Perché Rust',
      durationMs: 5000,
      segments: [
        { startMs: 0, endMs: 400, text: 'Ciao.' },
        { startMs: 2000, endMs: 2400, text: 'Rust.' },
      ],
    });
    expect(autoEditRequest({ ...project, transcript: null }, 7)).toBeNull();
  });

  it('riassume tagli, titolo, parole chiave e zoom', () => {
    expect(autoEditToast(summary)).toMatch(
      /^Tolti 3 silenzi, 1 esitazione, 2 riempitivi \(−4,2 s\) · titolo d’apertura · 5 parole chiave · 4 zoom\./,
    );
    expect(
      autoEditToast({ ...summary, silences: 0, hesitations: 0, fillers: 0, hook: false }),
    ).toMatch(/^Nessun taglio da fare · 5 parole chiave/);
  });

  it('restringe il riquadro attorno al centro quando c’è uno zoom', () => {
    const overlay = { left: 20, top: 0, width: 40, height: 100 };
    expect(zoomedOverlay(overlay, 1)).toBe(overlay);
    expect(zoomedOverlay(overlay, 1.25)).toEqual({ left: 24, top: 10, width: 32, height: 80 });
  });
});
