import type { ZodType } from 'zod';
import { LlmError, type LlmMessage } from './types.js';

/** Una singola chiamata al modello che restituisce il testo grezzo della risposta. */
export type RawCompletion = (messages: LlmMessage[]) => Promise<string>;

/**
 * Chiede al modello un JSON valido e conforme allo schema, ritentando quando:
 * - la risposta è vuota (DeepSeek la svuota se non riconosce il JSON);
 * - il testo non è JSON;
 * - il JSON non rispetta lo schema: in questo caso il modello riceve gli errori da correggere.
 */
export async function completeValidatedJson<T>(
  complete: RawCompletion,
  messages: LlmMessage[],
  schema: ZodType<T>,
  maxAttempts = 3,
): Promise<T> {
  let conversation = [...messages];
  let lastProblem = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = (await complete(conversation)).trim();
    if (!raw) {
      lastProblem = 'risposta vuota';
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      lastProblem = 'risposta non in formato JSON';
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return result.data;

    lastProblem = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(radice)'}: ${issue.message}`)
      .join('; ');
    conversation = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `Il JSON non rispetta il formato richiesto (${lastProblem}). Rispondi di nuovo con il JSON completo e corretto.`,
      },
    ];
  }

  throw new LlmError(`Il modello non ha prodotto una risposta valida: ${lastProblem}`);
}
