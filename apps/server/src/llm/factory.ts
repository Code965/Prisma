import type { Env } from '../config/env.js';
import { createDeepSeekProvider } from './deepseek.js';
import type { LlmProvider } from './types.js';

/** Restituisce null senza chiave API: il server parte comunque, le funzioni AI rispondono 503. */
export function createLlmProvider(env: Env): LlmProvider | null {
  if (!env.DEEPSEEK_API_KEY?.trim()) return null;
  return createDeepSeekProvider({
    apiKey: env.DEEPSEEK_API_KEY.trim(),
    baseURL: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
    timeoutMs: env.DEEPSEEK_TIMEOUT_MS,
  });
}
