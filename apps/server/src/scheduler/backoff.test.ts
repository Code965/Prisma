import { describe, expect, it } from 'vitest';
import { backoffDelayMs } from './backoff.js';

const noJitter = { baseMs: 60_000, maxMs: 3_600_000, jitter: 0 };

describe('backoff esponenziale', () => {
  it('raddoppia a ogni tentativo', () => {
    expect([1, 2, 3, 4].map((n) => backoffDelayMs(n, noJitter))).toEqual([
      60_000, 120_000, 240_000, 480_000,
    ]);
  });

  it('non supera il tetto', () => {
    expect(backoffDelayMs(20, noJitter)).toBe(3_600_000);
  });

  it('applica il jitter entro i limiti', () => {
    const options = { ...noJitter, jitter: 0.2 };
    expect(backoffDelayMs(1, options, () => 0)).toBe(48_000);
    expect(backoffDelayMs(1, options, () => 1)).toBe(72_000);
    expect(backoffDelayMs(20, options, () => 1)).toBe(3_600_000);
  });
});
