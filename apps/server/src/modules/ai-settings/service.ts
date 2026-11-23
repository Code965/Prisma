import {
  AI_PRESET_INFO,
  type AiSettingsInput,
  type AiSettingsTestResult,
  type AiSettingsView,
} from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { aiSettings } from '../../db/schema.js';
import { BusinessRuleError, NotConfiguredError } from '../../http/error-handler.js';
import { createProviderFromConfig, type AiProviderConfig } from '../../llm/factory.js';
import { LlmError, type LlmProvider, type LlmSource } from '../../llm/types.js';

const ROW_ID = 1;
/** Contesto della cifratura: la chiave cifrata non si può spostare su un altro campo. */
const KEY_CONTEXT = tokenContext('ai', 'settings');

export interface AiSettingsConfig {
  cipher: TokenCipher;
  /** Ripiego del .env del server, usato finché nelle Impostazioni non c'è nulla. */
  env: AiProviderConfig | null;
  timeoutMs: number;
  /** Solo per i test. */
  makeProvider?: (config: AiProviderConfig) => LlmProvider;
}

const PingSchema = z.object({ ok: z.boolean() });

/**
 * Servizio AI scelto dall'utente (Impostazioni › AI): qualsiasi servizio compatibile OpenAI,
 * locale (Ollama, LM Studio) o in rete (DeepSeek, OpenAI, OpenRouter…). La chiave resta cifrata
 * sul server e non torna mai al desktop. `source` dà ai servizi il provider in uso a ogni
 * operazione, così un cambio vale subito senza riavviare.
 */
export function createAiSettingsService(deps: { db: DbExecutor; config: AiSettingsConfig | null }) {
  const make = (config: AiProviderConfig) =>
    deps.config?.makeProvider?.(config) ??
    createProviderFromConfig(config, deps.config?.timeoutMs ?? 120_000);
  // Il provider si ricrea solo quando cambiano le impostazioni (conserva il ripiego sul JSON mode).
  let cached: { key: string; provider: LlmProvider } | null = null;

  function requireConfig(): AiSettingsConfig {
    if (!deps.config) throw new NotConfiguredError('Cifratura non configurata sul server');
    return deps.config;
  }

  async function readRow() {
    const [row] = await deps.db.select().from(aiSettings).where(eq(aiSettings.id, ROW_ID));
    return row ?? null;
  }

  function decryptKey(enc: Buffer | null): string | null {
    if (!enc) return null;
    return requireConfig().cipher.decrypt(enc, KEY_CONTEXT);
  }

  /** Configurazione in uso: le Impostazioni se ci sono, altrimenti il .env. */
  async function activeConfig(): Promise<AiProviderConfig | null> {
    if (!deps.config) return null;
    const row = await readRow();
    if (row) {
      return {
        preset: row.preset,
        baseUrl: row.baseUrl,
        model: row.model,
        apiKey: decryptKey(row.apiKeyEnc),
      };
    }
    return deps.config.env;
  }

  function providerFor(config: AiProviderConfig): LlmProvider {
    const key = JSON.stringify(config);
    if (cached?.key !== key) cached = { key, provider: make(config) };
    return cached.provider;
  }

  /** Configurazione da provare o salvare: la chiave assente resta quella salvata. */
  async function resolveInput(input: AiSettingsInput): Promise<AiProviderConfig> {
    const row = await readRow();
    const apiKey =
      input.apiKey === undefined ? (row ? decryptKey(row.apiKeyEnc) : null) : input.apiKey || null;
    const info = AI_PRESET_INFO[input.preset];
    if (info.needsKey && !apiKey) {
      throw new BusinessRuleError(`Per ${info.label} serve la chiave API`);
    }
    return { preset: input.preset, baseUrl: input.baseUrl, model: input.model, apiKey };
  }

  const source: LlmSource = {
    async current() {
      const config = await activeConfig();
      return config ? providerFor(config) : null;
    },
  };

  async function view(): Promise<AiSettingsView> {
    const row = deps.config ? await readRow() : null;
    if (row) {
      return {
        source: 'impostazioni',
        preset: row.preset,
        baseUrl: row.baseUrl,
        model: row.model,
        hasKey: row.apiKeyEnc !== null,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    const env = deps.config?.env ?? null;
    return env
      ? {
          source: 'env',
          preset: env.preset,
          baseUrl: env.baseUrl,
          model: env.model,
          hasKey: Boolean(env.apiKey),
          updatedAt: null,
        }
      : {
          source: 'nessuna',
          preset: null,
          baseUrl: null,
          model: null,
          hasKey: false,
          updatedAt: null,
        };
  }

  return {
    source,
    view,

    async save(input: AiSettingsInput): Promise<AiSettingsView> {
      const { cipher } = requireConfig();
      const config = await resolveInput(input);
      const values = {
        preset: config.preset,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKeyEnc: config.apiKey ? cipher.encrypt(config.apiKey, KEY_CONTEXT) : null,
      };
      await deps.db
        .insert(aiSettings)
        .values({ id: ROW_ID, ...values })
        .onConflictDoUpdate({ target: aiSettings.id, set: { ...values, updatedAt: new Date() } });
      return view();
    },

    /** Torna al ripiego del .env (o a nessuna AI). */
    async remove(): Promise<AiSettingsView> {
      requireConfig();
      await deps.db.delete(aiSettings).where(eq(aiSettings.id, ROW_ID));
      return view();
    },

    /**
     * Prova un servizio con una domanda minima prima di salvarlo (o quello salvato, senza corpo).
     * Un errore diventa 422 con il messaggio del servizio.
     */
    async test(input: AiSettingsInput | null): Promise<AiSettingsTestResult> {
      requireConfig();
      const config = input ? await resolveInput(input) : await activeConfig();
      if (!config) throw new BusinessRuleError('Nessun servizio AI da provare');
      const startedAt = Date.now();
      try {
        await make(config).completeJson({
          schema: PingSchema,
          maxTokens: 50,
          temperature: 0,
          messages: [
            { role: 'system', content: 'Rispondi solo in JSON, come nell’esempio: {"ok": true}' },
            { role: 'user', content: 'Rispondi con il json {"ok": true}' },
          ],
        });
      } catch (error) {
        if (error instanceof LlmError) {
          const unreachable = /connection error|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(
            error.message,
          );
          throw new BusinessRuleError(
            unreachable
              ? `${error.message}. Il servizio non risponde: controlla che sia avviato e che l’indirizzo sia giusto.`
              : error.message,
          );
        }
        throw error;
      }
      return { ok: true, model: config.model, durationMs: Date.now() - startedAt };
    },
  };
}

export type AiSettingsService = ReturnType<typeof createAiSettingsService>;
