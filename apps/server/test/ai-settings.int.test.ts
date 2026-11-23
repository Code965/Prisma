import type { AiSettingsView } from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { tokenContext } from '../src/crypto/token-cipher.js';
import { aiSettings } from '../src/db/schema.js';
import type { AiProviderConfig } from '../src/llm/factory.js';
import { LlmError } from '../src/llm/types.js';
import type { AiSettingsConfig } from '../src/modules/ai-settings/service.js';
import { FakeLlm } from './helpers/fake-llm.js';
import {
  TEST_CIPHER,
  closeDatabase,
  databaseUrl,
  withRollback,
  type TestContext,
} from './helpers/integration.js';

const ENV: AiProviderConfig = {
  preset: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'chiave-del-env',
};

/** Ogni provider creato è un FakeLlm; si registrano le configurazioni ricevute. */
function settingsConfig(env: AiProviderConfig | null = null) {
  const made: AiProviderConfig[] = [];
  let fail: string | null = null;
  const config: AiSettingsConfig = {
    cipher: TEST_CIPHER,
    env,
    timeoutMs: 1000,
    makeProvider: (provider) => {
      made.push(provider);
      const llm = new FakeLlm();
      if (fail) {
        const message = fail;
        llm.completeJson = async () => {
          throw new LlmError(message);
        };
      } else {
        llm.responses.push({ ok: true });
      }
      return llm;
    },
  };
  return { config, made, failWith: (message: string | null) => (fail = message) };
}

const view = async (ctx: TestContext) =>
  (await ctx.call({ method: 'GET', url: '/ai/settings' })).json<AiSettingsView>();

describe.skipIf(!databaseUrl)('impostazioni dell’AI (MySQL)', () => {
  afterAll(closeDatabase);

  it('senza impostazioni usa il .env, poi quelle salvate; la chiave resta cifrata', async () => {
    const { config, made } = settingsConfig(ENV);
    await withRollback(
      async (ctx) => {
        await ctx.tx.delete(aiSettings);
        expect(await view(ctx)).toMatchObject({ source: 'env', preset: 'deepseek', hasKey: true });

        // DeepSeek senza chiave non si salva.
        const missing = await ctx.call({
          method: 'PUT',
          url: '/ai/settings',
          payload: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm' },
        });
        expect(missing.statusCode).toBe(422);

        const saved = await ctx.call({
          method: 'PUT',
          url: '/ai/settings',
          payload: {
            preset: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1/',
            model: 'modello-gratis',
            apiKey: ' sk-or-123 ',
          },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toMatchObject({
          source: 'impostazioni',
          baseUrl: 'https://openrouter.ai/api/v1',
          hasKey: true,
        });
        expect(saved.body).not.toContain('sk-or-123');
        const [row] = await ctx.tx.select().from(aiSettings).where(eq(aiSettings.id, 1));
        expect(TEST_CIPHER.decrypt(row!.apiKeyEnc!, tokenContext('ai', 'settings'))).toBe(
          'sk-or-123',
        );

        // Senza apiKey si tiene quella salvata; il test usa il servizio in uso.
        await ctx.call({
          method: 'PUT',
          url: '/ai/settings',
          payload: {
            preset: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            model: 'altro',
          },
        });
        const tested = await ctx.call({ method: 'POST', url: '/ai/settings/test' });
        expect(tested.json()).toMatchObject({ ok: true, model: 'altro' });
        expect(made.at(-1)).toMatchObject({ model: 'altro', apiKey: 'sk-or-123' });

        // Un servizio locale senza chiave: "" la toglie.
        const local = await ctx.call({
          method: 'PUT',
          url: '/ai/settings',
          payload: {
            preset: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen3',
            apiKey: '',
          },
        });
        expect(local.json()).toMatchObject({ preset: 'ollama', hasKey: false });

        const removed = await ctx.call({ method: 'DELETE', url: '/ai/settings' });
        expect(removed.json()).toMatchObject({ source: 'env' });
      },
      { aiSettings: config },
    );
  });

  it('la prova di un servizio che non risponde dà 422 con il motivo', async () => {
    const { config, failWith } = settingsConfig(null);
    await withRollback(
      async (ctx) => {
        await ctx.tx.delete(aiSettings);
        expect(await view(ctx)).toMatchObject({ source: 'nessuna' });
        failWith('Chiamata a Ollama fallita: connect ECONNREFUSED');
        const res = await ctx.call({
          method: 'POST',
          url: '/ai/settings/test',
          payload: { preset: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3' },
        });
        expect(res.statusCode).toBe(422);
        expect(res.json<{ message: string }>().message).toMatch(/ECONNREFUSED/);
      },
      { aiSettings: config },
    );
  });

  it('senza AI configurata le funzioni AI rispondono 503 con il rimando alle Impostazioni', async () => {
    const { config } = settingsConfig(null);
    await withRollback(
      async (ctx) => {
        await ctx.tx.delete(aiSettings);
        const brandId = await ctx.createBrand();
        const res = await ctx.call({
          method: 'POST',
          url: `/brands/${brandId}/analytics/insights`,
        });
        expect(res.statusCode).toBe(503);
        expect(res.json<{ message: string }>().message).toMatch(/Impostazioni › AI/);
      },
      { aiSettings: config },
    );
  });
});
