import { PLATFORMS, PLATFORM_LABELS, type BrandKit, type Platform } from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { Icon } from '../../components/icons/Icon';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import {
  useAddVoiceExample,
  useDeleteVoiceExample,
  useSaveBrandKit,
  useVoiceExamples,
} from '../../hooks/useBrandKit';
import { errorMessage } from '../../services/api/client';
import { addRule, removeRule, voiceExampleMeta } from '../../services/brand-kit';
import styles from './Template.module.css';

/** Voce: regole (salvate subito nel kit) ed esempi di post che l'LLM imita. */
export function VoicePanel({ kit }: { kit: BrandKit }) {
  const examples = useVoiceExamples();
  const saveKit = useSaveBrandKit();
  const remove = useDeleteVoiceExample();
  const [rule, setRule] = useState('');
  const [adding, setAdding] = useState(false);

  const saveRules = (voiceRules: string[]) => saveKit.mutate({ ...kit, voiceRules });

  return (
    <section aria-labelledby="h-voce" className={`${styles.panel} ${styles.voicePanel}`}>
      <div className={styles.voiceHead}>
        <h2 id="h-voce" className={styles.h2}>
          Voce
        </h2>
        <span className={styles.hint}>
          L’LLM riceve questi esempi e queste regole a ogni generazione
        </span>
      </div>

      <ul className={styles.rules} aria-label="Regole della voce">
        {kit.voiceRules.map((r) => (
          <li key={r} className={styles.rule}>
            {r}
            <button
              type="button"
              className={styles.ruleRemove}
              aria-label={`Rimuovi la regola ${r}`}
              disabled={saveKit.isPending}
              onClick={() => saveRules(removeRule(kit.voiceRules, r))}
            >
              ×
            </button>
          </li>
        ))}
        <li>
          <input
            className={styles.ruleInput}
            value={rule}
            maxLength={80}
            placeholder="+ regola (Invio)"
            aria-label="Nuova regola della voce"
            disabled={saveKit.isPending || kit.voiceRules.length >= 20}
            onChange={(event) => setRule(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const next = addRule(kit.voiceRules, rule);
              setRule('');
              if (next.length !== kit.voiceRules.length) saveRules(next);
            }}
          />
        </li>
      </ul>
      {saveKit.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(saveKit.error)}
        </p>
      ) : null}

      {(examples.data ?? []).map((example) => (
        <div key={example.id} className={styles.example}>
          <PlatformIcon platform={example.platform} size={24} />
          <div className={styles.exampleText}>
            <p className={styles.exampleBody}>{example.text}</p>
            <span className={styles.exampleMeta}>{voiceExampleMeta(example)}</span>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rimuovi l’esempio"
            disabled={remove.isPending}
            onClick={() => remove.mutate(example.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      {examples.data?.length === 0 && !adding && (
        <p className={styles.hint}>
          Nessun esempio: aggiungi due o tre post scritti da te, l’LLM ne imiterà il tono.
        </p>
      )}

      {adding ? (
        <ExampleForm onDone={() => setAdding(false)} />
      ) : (
        <Button
          variant="secondary"
          size={36}
          className={styles.addExample}
          onClick={() => setAdding(true)}
        >
          + Aggiungi un mio post come esempio
        </Button>
      )}
      {examples.error || remove.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(examples.error ?? remove.error)}
        </p>
      ) : null}
    </section>
  );
}

function ExampleForm({ onDone }: { onDone: () => void }) {
  const add = useAddVoiceExample();
  const [platform, setPlatform] = useState<Platform>('linkedin');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');

  return (
    <form
      className={styles.exampleForm}
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate({ platform, text, note }, { onSuccess: onDone });
      }}
    >
      <div className={styles.formRow}>
        <label className={styles.formField}>
          <span className={styles.groupLabel}>Piattaforma</span>
          <select
            className={styles.input}
            value={platform}
            onChange={(event) => setPlatform(event.target.value as Platform)}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.formField} ${styles.grow}`}>
          <span className={styles.groupLabel}>Perché è un buon esempio (facoltativo)</span>
          <input
            className={styles.input}
            value={note}
            maxLength={200}
            placeholder="es. apertura, chiusura, tono"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <label className={styles.formField}>
        <span className={styles.groupLabel}>Testo del post</span>
        <textarea
          className={styles.textarea}
          rows={5}
          value={text}
          maxLength={3000}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className={styles.saveRow}>
        <Button type="submit" size={36} disabled={!text.trim() || add.isPending}>
          {add.isPending ? 'Salvo…' : 'Aggiungi esempio'}
        </Button>
        <Button variant="secondary" size={36} onClick={onDone}>
          Annulla
        </Button>
      </div>
      {add.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(add.error)}
        </p>
      ) : null}
    </form>
  );
}
