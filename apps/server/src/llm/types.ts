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
    super('Provider LLM non configurato: imposta DEEPSEEK_API_KEY nel .env del server');
    this.name = 'LlmNotConfiguredError';
  }
}
