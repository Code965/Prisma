import { AI_PRESET_INFO, type AiSettingsView } from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import {
  useAiSettings,
  useRemoveAiSettings,
  useSaveAiSettings,
  useTestAiSettings,
} from '../../hooks/useAiSettings';
import {
  AI_PRESET_ORDER,
  aiFormInput,
  aiFormProblem,
  aiStatusLabel,
  initialAiForm,
  switchPreset,
  type AiForm,
} from '../../services/ai-settings';
import { errorMessage } from '../../services/api/client';
import styles from './Impostazioni.module.css';

/**
 * Impostazioni › AI: il servizio che scrive le bozze. Qualsiasi servizio compatibile OpenAI,
 * gratuito sul computer (Ollama, LM Studio) o in rete con la propria chiave. La chiave va al
 * server, che la conserva cifrata e non la rimanda mai indietro.
 */
export function AiSettingsSection() {
  const settings = useAiSettings();

  return (
    <section aria-labelledby="h-ai" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="h-ai" className={styles.sectionTitle}>
          AI
        </h2>
        <span className={styles.sectionHint}>
          Il modello che scrive bozze, caroselli, Short e suggerimenti
        </span>
      </div>
      {settings.data ? (
        // Rimontato quando cambiano le impostazioni salvate: il modulo riparte da quelle.
        <AiSettingsForm
          key={settings.data.updatedAt ?? settings.data.source}
          view={settings.data}
        />
      ) : settings.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(settings.error)}
        </p>
      ) : (
        <span className={styles.sectionHint}>Carico…</span>
      )}
    </section>
  );
}

function AiSettingsForm({ view }: { view: AiSettingsView }) {
  const save = useSaveAiSettings();
  const remove = useRemoveAiSettings();
  const test = useTestAiSettings();
  const [form, setForm] = useState<AiForm>(() => initialAiForm(view));
  const info = AI_PRESET_INFO[form.preset];
  const problem = aiFormProblem(form, view);
  const busy = save.isPending || test.isPending || remove.isPending;
  const keySaved = view.source === 'impostazioni' && view.preset === form.preset && view.hasKey;

  const update = (patch: Partial<AiForm>) => {
    test.reset();
    setForm((current) => ({ ...current, ...patch }));
  };

  return (
    <div className={styles.aiForm}>
      <span className={styles.accountStatus}>{aiStatusLabel(view)}</span>

      <div role="radiogroup" aria-label="Servizio AI" className={styles.presets}>
        {AI_PRESET_ORDER.map((preset) => {
          const presetInfo = AI_PRESET_INFO[preset];
          const active = preset === form.preset;
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.preset} ${active ? styles.presetOn : ''}`}
              onClick={() => {
                test.reset();
                setForm((current) => switchPreset(current, preset));
              }}
            >
              <span className={styles.brandName}>{presetInfo.label}</span>
              <span className={styles.presetTag}>
                {presetInfo.local
                  ? 'Gratis · sul tuo PC'
                  : presetInfo.needsKey
                    ? 'Con chiave'
                    : 'In rete'}
              </span>
            </button>
          );
        })}
      </div>
      <span className={styles.sectionHint}>{info.description}</span>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="ai-url" className={styles.label}>
            Indirizzo del servizio
          </label>
          <input
            id="ai-url"
            className={`${styles.input} mono`}
            value={form.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="https://…/v1"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="ai-model" className={styles.label}>
            Modello
          </label>
          <input
            id="ai-model"
            className={`${styles.input} mono`}
            value={form.model}
            onChange={(event) => update({ model: event.target.value })}
            placeholder={info.modelHint}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="ai-key" className={styles.label}>
            Chiave API{info.needsKey ? '' : ' (se serve)'}
          </label>
          <input
            id="ai-key"
            type="password"
            className={`${styles.input} mono`}
            value={form.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            placeholder={keySaved ? 'Salvata: lascia vuoto per tenerla' : 'Incolla la chiave'}
            autoComplete="off"
          />
        </div>
      </div>
      <span className={styles.sectionHint}>
        {problem ??
          'Prova il collegamento prima di salvare: Prisma fa una domanda brevissima al modello.'}
      </span>

      <div className={styles.buttons}>
        <Button
          variant="secondary"
          size={32}
          disabled={busy || problem !== null}
          onClick={() => test.mutate(aiFormInput(form, view))}
        >
          {test.isPending ? 'Provo…' : 'Prova'}
        </Button>
        <Button
          size={32}
          disabled={busy || problem !== null}
          onClick={() => save.mutate(aiFormInput(form, view))}
        >
          {save.isPending ? 'Salvo…' : 'Salva'}
        </Button>
        {view.source === 'impostazioni' && (
          <Button
            variant="secondary"
            size={32}
            disabled={busy}
            onClick={() =>
              window.confirm(
                'Togliere il servizio AI salvato? Si torna al .env del server, se c’è.',
              ) && remove.mutate()
            }
          >
            Togli
          </Button>
        )}
        {test.data && (
          <span className={styles.ok}>
            Risponde · {(test.data.durationMs / 1000).toFixed(1).replace('.', ',')} s
          </span>
        )}
        {save.isSuccess && !test.data && <span className={styles.ok}>Salvato</span>}
      </div>
      {save.error || test.error || remove.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error ?? test.error ?? remove.error)}
        </p>
      ) : null}
    </div>
  );
}
