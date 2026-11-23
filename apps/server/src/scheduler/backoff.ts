export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Variazione casuale relativa, es. 0.2 = ±20%, per non ritentare tutto nello stesso istante. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 60_000,
  maxMs: 60 * 60_000,
  jitter: 0.2,
};

/**
 * Attesa prima del tentativo successivo: base · 2^(tentativo − 1), con tetto e jitter.
 * Con i default: ~1, 2, 4, 8, 16 minuti… fino a un'ora.
 */
export function backoffDelayMs(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(options.maxMs, options.baseMs * 2 ** exponent);
  const factor = 1 + options.jitter * (random() * 2 - 1);
  return Math.round(Math.min(options.maxMs, raw * factor));
}
