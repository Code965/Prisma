import type { JsonCompletionRequest, LlmMessage, LlmProvider } from '../../src/llm/types.js';

/**
 * LLM finto: restituisce le risposte accodate passando dallo stesso schema Zod del provider vero,
 * così i test verificano anche la normalizzazione (es. hashtag).
 */
export class FakeLlm implements LlmProvider {
  readonly name = 'fake';
  readonly requests: LlmMessage[][] = [];
  readonly responses: unknown[] = [];

  async completeJson<T>(request: JsonCompletionRequest<T>): Promise<T> {
    this.requests.push(request.messages);
    if (this.responses.length === 0) throw new Error('FakeLlm: nessuna risposta accodata');
    return request.schema.parse(this.responses.shift());
  }

  /** Testo completo dei messaggi dell'ultima richiesta, per controllare cosa vede il modello. */
  lastPrompt(): string {
    return (this.requests.at(-1) ?? []).map((message) => message.content).join('\n');
  }
}
