import {
  AI_PRESET_INFO,
  AI_PRESETS,
  type AiPreset,
  type AiSettingsInput,
  type AiSettingsView,
} from '@prisma-app/shared';

/** Campi del modulo «AI». `apiKey` vuoto = lascia quella salvata (se c'è). */
export interface AiForm {
  preset: AiPreset;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Ordine nel modulo: prima i servizi gratuiti sul computer, poi quelli in rete. */
export const AI_PRESET_ORDER: readonly AiPreset[] = [
  ...AI_PRESETS.filter((preset) => AI_PRESET_INFO[preset].local),
  ...AI_PRESETS.filter((preset) => !AI_PRESET_INFO[preset].local),
];

export function presetForm(preset: AiPreset): AiForm {
  const info = AI_PRESET_INFO[preset];
  return { preset, baseUrl: info.baseUrl, model: info.model, apiKey: '' };
}

/** Il modulo parte dal servizio salvato; senza, da Ollama (gratis, sul computer). */
export function initialAiForm(view: AiSettingsView | undefined): AiForm {
  if (view?.source === 'impostazioni' && view.preset) {
    return {
      preset: view.preset,
      baseUrl: view.baseUrl ?? '',
      model: view.model ?? '',
      apiKey: '',
    };
  }
  return presetForm('ollama');
}

/**
 * Cambio di servizio: indirizzo e modello passano ai valori del nuovo servizio, salvo quelli che
 * l'utente aveva già cambiato rispetto ai valori proposti.
 */
export function switchPreset(form: AiForm, preset: AiPreset): AiForm {
  const previous = AI_PRESET_INFO[form.preset];
  const next = AI_PRESET_INFO[preset];
  return {
    preset,
    baseUrl: !form.baseUrl || form.baseUrl === previous.baseUrl ? next.baseUrl : form.baseUrl,
    model: !form.model || form.model === previous.model ? next.model : form.model,
    apiKey: '',
  };
}

/** Il servizio del modulo è quello già salvato (la chiave vuota vuol dire «tieni quella»). */
function sameSavedPreset(form: AiForm, view: AiSettingsView | undefined): boolean {
  return view?.source === 'impostazioni' && view.preset === form.preset;
}

/** Cosa manca per provare o salvare; null se il modulo è completo. */
export function aiFormProblem(form: AiForm, view: AiSettingsView | undefined): string | null {
  if (!/^https?:\/\/\S+$/i.test(form.baseUrl.trim())) return 'Indica l’indirizzo del servizio';
  if (!form.model.trim()) return 'Indica il modello';
  const info = AI_PRESET_INFO[form.preset];
  const keyAvailable = form.apiKey.trim() || (sameSavedPreset(form, view) && view?.hasKey);
  if (info.needsKey && !keyAvailable) return `Inserisci la chiave API di ${info.label}`;
  return null;
}

/** Dati da inviare: senza chiave nuova si tiene quella salvata, cambiando servizio si toglie. */
export function aiFormInput(form: AiForm, view: AiSettingsView | undefined): AiSettingsInput {
  const apiKey = form.apiKey.trim();
  return {
    preset: form.preset,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    ...(apiKey ? { apiKey } : sameSavedPreset(form, view) ? {} : { apiKey: '' }),
  };
}

/** Riga di stato: quale AI è in uso adesso e da dove arriva. */
export function aiStatusLabel(view: AiSettingsView): string {
  if (view.source === 'nessuna' || !view.preset) {
    return 'Nessuna AI configurata: generazione e modifica dei contenuti non sono disponibili';
  }
  const where = view.source === 'env' ? ' · dal file .env (ripiego)' : '';
  return `In uso: ${AI_PRESET_INFO[view.preset].label} · ${view.model ?? ''}${where}`;
}
