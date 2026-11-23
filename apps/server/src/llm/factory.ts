import { AI_PRESET_INFO, type AiPreset } from '@prisma-app/shared';
import type { Env } from '../config/env.js';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import type { LlmProvider } from './types.js';

export interface AiProviderConfig {
  preset: AiPreset;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

/** Provider per un servizio scelto nelle Impostazioni (o letto dal .env). */
export function createProviderFromConfig(config: AiProviderConfig, timeoutMs: number): LlmProvider {
  return createOpenAiCompatibleProvider({
    label: AI_PRESET_INFO[config.preset].label,
    apiKey: config.apiKey ?? '',
    baseURL: config.baseUrl,
    model: config.model,
    timeoutMs,
  });
}

/**
 * Ripiego del .env del server (`DEEPSEEK_*`), usato finché nelle Impostazioni non c'è un servizio
 * scelto. Null senza chiave.
 */
export function envProviderConfig(env: Env): AiProviderConfig | null {
  if (!env.DEEPSEEK_API_KEY?.trim()) return null;
  return {
    preset: 'deepseek',
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
    apiKey: env.DEEPSEEK_API_KEY.trim(),
  };
}
