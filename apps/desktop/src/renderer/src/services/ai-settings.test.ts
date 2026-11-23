import type { AiSettingsView } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  AI_PRESET_ORDER,
  aiFormInput,
  aiFormProblem,
  aiStatusLabel,
  initialAiForm,
  presetForm,
  switchPreset,
} from './ai-settings';

const saved: AiSettingsView = {
  source: 'impostazioni',
  preset: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  hasKey: true,
  updatedAt: '2026-11-23T10:00:00.000Z',
};
const none: AiSettingsView = {
  source: 'nessuna',
  preset: null,
  baseUrl: null,
  model: null,
  hasKey: false,
  updatedAt: null,
};

describe('impostazioni dell’AI', () => {
  it('propone prima i servizi locali e parte da Ollama senza impostazioni', () => {
    expect(AI_PRESET_ORDER.slice(0, 2)).toEqual(['ollama', 'lmstudio']);
    expect(initialAiForm(none)).toEqual(presetForm('ollama'));
    expect(initialAiForm(saved)).toMatchObject({ preset: 'deepseek', model: 'deepseek-flash' });
  });

  it('cambiando servizio aggiorna indirizzo e modello solo se non sono stati toccati', () => {
    const form = presetForm('ollama');
    expect(switchPreset(form, 'deepseek')).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    });
    const custom = { ...form, baseUrl: 'http://192.168.1.20:11434/v1', model: 'qwen3' };
    expect(switchPreset(custom, 'lmstudio')).toMatchObject({
      baseUrl: 'http://192.168.1.20:11434/v1',
      model: 'qwen3',
    });
  });

  it('chiede la chiave solo se serve e non è già salvata', () => {
    expect(aiFormProblem({ ...presetForm('ollama'), model: 'qwen3' }, none)).toBeNull();
    expect(aiFormProblem(presetForm('ollama'), none)).toMatch(/modello/);
    expect(aiFormProblem({ ...presetForm('openai'), model: 'm' }, none)).toMatch(/chiave/);
    expect(aiFormProblem(initialAiForm(saved), saved)).toBeNull();
  });

  it('senza chiave nuova tiene quella salvata, cambiando servizio la toglie', () => {
    expect(aiFormInput(initialAiForm(saved), saved)).not.toHaveProperty('apiKey');
    expect(aiFormInput({ ...presetForm('ollama'), model: 'qwen3' }, saved)).toMatchObject({
      apiKey: '',
    });
    expect(aiFormInput({ ...initialAiForm(saved), apiKey: ' sk-1 ' }, saved).apiKey).toBe('sk-1');
  });

  it('dice quale AI è in uso e da dove', () => {
    expect(aiStatusLabel(saved)).toBe('In uso: DeepSeek · deepseek-flash');
    expect(aiStatusLabel({ ...saved, source: 'env' })).toMatch(/\.env/);
    expect(aiStatusLabel(none)).toMatch(/Nessuna AI/);
  });
});
