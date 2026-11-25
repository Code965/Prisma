import { describe, expect, it } from 'vitest';
import {
  faceSampleTimes,
  followOffsetAt,
  followPath,
  followSegment,
  freeAxis,
  simplifyPath,
  type FaceTrack,
} from './video-face.js';

/** Volto fermo a `x` fino a `switchMs`, poi fermo a `x2` (sorgente 16:9). */
function track(x: number, x2: number, switchMs: number, totalMs = 10_000): FaceTrack {
  const samples = [];
  for (let ms = 0; ms < totalMs; ms += 250) {
    samples.push({ ms, x: ms < switchMs ? x : x2, y: 0.4, size: 0.2 });
  }
  return {
    intervalMs: 250,
    samples,
    coverage: 1,
    model: 'blaze',
    createdAt: '2026-11-25T10:00:00.000Z',
  };
}

describe('inquadratura che segue il volto', () => {
  it('asse libero: orizzontale per 9:16 da 16:9, nessuno se il formato coincide', () => {
    expect(freeAxis('9:16', 1920, 1080)).toBe('x');
    expect(freeAxis('16:9', 1080, 1920)).toBe('y');
    expect(freeAxis('16:9', 1920, 1080)).toBeNull();
    expect(followPath(track(0.5, 0.5, 0), '16:9', 1920, 1080)).toEqual([]);
  });

  it('volto fermo nella zona centrale: la camera non si muove', () => {
    const path = followPath(track(0.53, 0.53, 0), '9:16', 1920, 1080, 0.5);
    expect(path).toHaveLength(2);
    expect(path.every((p) => Math.abs(p.offset - 0.5) < 1e-9)).toBe(true);
  });

  it('il volto si sposta: la camera lo raggiunge senza scatti e si ferma', () => {
    const path = followPath(track(0.5, 0.8, 3000), '9:16', 1920, 1080, 0.5);
    // Ferma fino allo spostamento, poi sale fino a centrare il volto.
    expect(followOffsetAt(path, 1500, 0.5)).toBeCloseTo(0.5, 9);
    expect(followOffsetAt(path, 2750, 0.5)).toBeCloseTo(0.5, 9);
    const end = followOffsetAt(path, 9750, 0.5);
    // Ritaglio 9:16 su 1920×1080: larghezza 607,5 px = 0,316; offset del volto a 0,8 ≈ 0,94.
    expect(end).toBeGreaterThan(0.85);
    expect(end).toBeLessThanOrEqual(1);
    // Nessun salto: tra due campioni la posizione cambia poco (velocità limitata).
    let previous = followOffsetAt(path, 3000, 0.5);
    for (let ms = 3250; ms < 10_000; ms += 250) {
      const offset = followOffsetAt(path, ms, 0.5);
      expect(Math.abs(offset - previous)).toBeLessThan(0.08);
      previous = offset;
    }
    expect(path.length).toBeLessThan(25);
  });

  it('senza volto resta dov’era', () => {
    const t = track(0.8, 0.8, 0);
    t.samples = t.samples.map((s) => (s.ms > 5000 ? { ...s, x: null, y: null, size: null } : s));
    const path = followPath(t, '9:16', 1920, 1080, 0.5);
    expect(followOffsetAt(path, 9000, 0.5)).toBeCloseTo(followOffsetAt(path, 5000, 0.5), 5);
  });

  it('semplifica, interpola e taglia per una parte', () => {
    const points = [0, 1, 2, 3, 4].map((i) => ({ ms: i * 1000, offset: i * 0.1 }));
    expect(simplifyPath(points, 0.001)).toEqual([points[0], points[4]]);
    expect(followOffsetAt(points, 1500, 0.5)).toBeCloseTo(0.15);
    expect(followOffsetAt([], 1500, 0.3)).toBe(0.3);
    expect(followSegment(points, 500, 2500, 0.5).map((p) => p.ms)).toEqual([500, 1000, 2000, 2500]);
    expect(faceSampleTimes(1000)).toEqual([0, 250, 500, 750]);
    expect(faceSampleTimes(240_000)[1]).toBe(500);
  });
});
