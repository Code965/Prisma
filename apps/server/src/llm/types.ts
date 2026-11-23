import type { ZodType } from 'zod';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface JsonCompletionRequest<T> {
  messages: LlmMessage[];
  /** La risposta viene validata con questo schema; se non è conforme si ritenta. */
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  readonly name: string;
  completeJson<T>(request: JsonCompletionRequest<T>): Promise<T>;
}

/**
 * Da dove arriva il provider: le impostazioni dell'AI scelte dall'utente possono cambiare mentre
 * il server gira, quindi i servizi lo chiedono a ogni operazione. null = AI non configurata.
 */
export interface LlmSource {
  current(): Promise<LlmProvider | null>;
}

export function staticLlmSource(provider: LlmProvider | null): LlmSource {
  return { current: async () => provider };
}

export function isLlmSource(value: LlmProvider | LlmSource): value is LlmSource {
  return typeof (value as LlmSource).current === 'function';
}

/** Il provider ha risposto male o non ha risposto: l'operazione si può ripetere. */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/** Manca la configurazione (es. chiave API): le funzioni AI non sono disponibili. */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super('AI non configurata: scegli il servizio e la chiave in Impostazioni › AI');
    this.name = 'LlmNotConfiguredError';
  }
}
