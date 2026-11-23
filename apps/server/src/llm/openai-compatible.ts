import OpenAI from 'openai';
import { completeValidatedJson } from './json-completion.js';
import {
  LlmError,
  type JsonCompletionRequest,
  type LlmMessage,
  type LlmProvider,
} from './types.js';

/** Il sottoinsieme del client OpenAI che serve: permette di sostituirlo nei test. */
export interface ChatCompletionsClient {
  create(params: {
    model: string;
    messages: LlmMessage[];
    response_format?: { type: 'json_object' };
    max_tokens: number;
    temperature: number;
  }): Promise<{ choices: { message: { content: string | null } }[] }>;
}

export interface OpenAiCompatibleOptions {
  /** Nome del servizio per i messaggi d'errore e per `name` (es. «DeepSeek», «Ollama»). */
  label: string;
  /** Vuota per i servizi locali che non la chiedono. */
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  /** Solo per i test. */
  client?: ChatCompletionsClient;
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/** Errore di un servizio che non accetta `response_format: json_object` (es. LM Studio). */
function rejectsJsonMode(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /response_format|json_object/i.test(message) &&
    /400|invalid|unsupported|not support/i.test(message)
  );
}

/**
 * Provider per qualsiasi servizio con l'API compatibile OpenAI (DeepSeek, Ollama, LM Studio,
 * OpenAI, OpenRouter…): SDK ufficiale con un'altra base URL. Chiede il JSON mode; se il servizio
 * non lo supporta lo si toglie e si continua solo con il prompt (che chiede sempre JSON con un
 * esempio) e la validazione di `completeValidatedJson`.
 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const client: ChatCompletionsClient =
    options.client ??
    new OpenAI({
      // L'SDK vuole sempre una chiave: i servizi locali ignorano quella di ripiego.
      apiKey: options.apiKey || 'non-richiesta',
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      maxRetries: 2,
    }).chat.completions;
  let jsonMode = true;

  return {
    name: `${options.label}:${options.model}`,
    completeJson<T>(request: JsonCompletionRequest<T>): Promise<T> {
      const complete = async (messages: LlmMessage[]): Promise<string> => {
        const params = {
          model: options.model,
          messages,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        };
        try {
          const response = await client.create(
            jsonMode ? { ...params, response_format: { type: 'json_object' } } : params,
          );
          return response.choices[0]?.message.content ?? '';
        } catch (error) {
          if (jsonMode && rejectsJsonMode(error)) {
            jsonMode = false;
            return complete(messages);
          }
          const detail = error instanceof Error ? error.message : String(error);
          throw new LlmError(`Chiamata a ${options.label} fallita: ${detail}`, { cause: error });
        }
      };
      return completeValidatedJson(complete, request.messages, request.schema);
    },
  };
}
