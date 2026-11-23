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
    response_format: { type: 'json_object' };
    max_tokens: number;
    temperature: number;
  }): Promise<{ choices: { message: { content: string | null } }[] }>;
}

export interface DeepSeekOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  /** Solo per i test. */
  client?: ChatCompletionsClient;
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * DeepSeek espone un'API compatibile con OpenAI: si usa l'SDK ufficiale con un'altra base URL.
 * JSON mode: `response_format: json_object`; il prompt deve contenere la parola "json" e un esempio.
 */
export function createDeepSeekProvider(options: DeepSeekOptions): LlmProvider {
  const client: ChatCompletionsClient =
    options.client ??
    new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      maxRetries: 2,
    }).chat.completions;

  return {
    name: `deepseek:${options.model}`,
    completeJson<T>(request: JsonCompletionRequest<T>): Promise<T> {
      const complete = async (messages: LlmMessage[]): Promise<string> => {
        try {
          const response = await client.create({
            model: options.model,
            messages,
            response_format: { type: 'json_object' },
            max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          });
          return response.choices[0]?.message.content ?? '';
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new LlmError(`Chiamata a DeepSeek fallita: ${detail}`, { cause: error });
        }
      };
      return completeValidatedJson(complete, request.messages, request.schema);
    },
  };
}
