import { z } from 'zod';

/**
 * Servizi AI che l'utente può scegliere. Tutti parlano l'API «compatibile OpenAI»
 * (`/chat/completions`): cambia solo l'indirizzo, il modello e se serve una chiave.
 */
export const AI_PRESETS = [
  'deepseek',
  'ollama',
  'lmstudio',
  'openai',
  'openrouter',
  'personalizzato',
] as const;
export type AiPreset = (typeof AI_PRESETS)[number];

export interface AiPresetInfo {
  label: string;
  baseUrl: string;
  /** Modello proposto; vuoto = lo sceglie l'utente (dipende da cosa ha installato o attivato). */
  model: string;
  modelHint: string;
  needsKey: boolean;
  /** Gira sul computer dell'utente: gratis e senza inviare i testi a terzi. */
  local: boolean;
  description: string;
}

export const AI_PRESET_INFO: Record<AiPreset, AiPresetInfo> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    modelHint: 'deepseek-flash o deepseek-v4-pro',
    needsKey: true,
    local: false,
    description:
      'Servizio a pagamento, pochi centesimi per contenuto. Chiave da platform.deepseek.com.',
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    modelHint: 'Il nome di un modello scaricato con «ollama pull»',
    needsKey: false,
    local: true,
    description: 'Gratis, sul tuo computer. Installa Ollama e scarica un modello.',
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    modelHint: 'L’identificativo del modello caricato in LM Studio',
    needsKey: false,
    local: true,
    description: 'Gratis, sul tuo computer. Avvia il server locale di LM Studio.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    modelHint: 'Un modello del tuo account OpenAI',
    needsKey: true,
    local: false,
    description: 'Servizio a pagamento. Chiave da platform.openai.com.',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    modelHint: 'L’identificativo del modello su OpenRouter (anche quelli gratuiti)',
    needsKey: true,
    local: false,
    description: 'Molti modelli con una sola chiave, alcuni gratuiti. Chiave da openrouter.ai.',
  },
  personalizzato: {
    label: 'Altro servizio compatibile',
    baseUrl: '',
    model: '',
    modelHint: 'Il nome del modello',
    needsKey: false,
    local: false,
    description: 'Qualsiasi servizio con l’API compatibile OpenAI (/chat/completions).',
  },
};

const BaseUrlSchema = z
  .string()
  .trim()
  .pipe(z.url())
  .refine((url) => /^https?:\/\//i.test(url), 'Serve un indirizzo http o https')
  .transform((url) => url.replace(/\/+$/, ''));

/** Impostazioni inviate dal desktop. `apiKey` assente = lascia quella salvata; "" = toglila. */
export const AiSettingsInputSchema = z.object({
  preset: z.enum(AI_PRESETS),
  baseUrl: BaseUrlSchema,
  model: z.string().trim().min(1, 'Indica il modello').max(200),
  apiKey: z.string().trim().max(1000).optional(),
});
export type AiSettingsInput = z.infer<typeof AiSettingsInputSchema>;

export const AI_SETTINGS_SOURCES = ['impostazioni', 'env', 'nessuna'] as const;

/** Cosa vede il desktop: mai la chiave, solo se c'è. */
export const AiSettingsViewSchema = z.object({
  /** Da dove arriva l'AI in uso: le Impostazioni, il .env del server o nessuna. */
  source: z.enum(AI_SETTINGS_SOURCES),
  preset: z.enum(AI_PRESETS).nullable(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  hasKey: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type AiSettingsView = z.infer<typeof AiSettingsViewSchema>;

export const AiSettingsTestResultSchema = z.object({
  ok: z.literal(true),
  model: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type AiSettingsTestResult = z.infer<typeof AiSettingsTestResultSchema>;
