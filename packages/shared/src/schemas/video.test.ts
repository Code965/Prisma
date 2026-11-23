import { describe, expect, it } from 'vitest';
import { formatDurationMs } from './video.js';

describe('durata dei video', () => {
  it('scrive minuti e secondi, e le ore quando servono', () => {
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatDurationMs(252_400)).toBe('4:12');
    expect(formatDurationMs(3_903_000)).toBe('1:05:03');
  });
});
