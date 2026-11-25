import type { Tag } from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { Icon } from '../../components/icons/Icon';
import { errorMessage } from '../../services/api/client';
import { useDictation } from '../../hooks/useDictation';
import { useNow } from '../../hooks/useNow';
import { appendDictation, micTitle } from '../../services/dictation';
import { toggleId } from '../../services/ideas';
import { timerLabel } from '../../services/recorder';
import styles from './Idee.module.css';

interface NewIdeaPanelProps {
  tags: Tag[];
  saving: boolean;
  error: unknown;
  onSave: (input: { text: string; tagIds: number[] }) => Promise<unknown>;
}

/** Inserimento rapido di un'idea con i tag di argomento (sezione "Nuova idea" del mockup). */
export function NewIdeaPanel({ tags, saving, error, onSave }: NewIdeaPanelProps) {
  const [text, setText] = useState('');
  const [tagIds, setTagIds] = useState<number[]>([]);
  const canSave = text.trim().length > 0 && !saving;
  const dictation = useDictation((dictated) =>
    setText((current) => appendDictation(current, dictated)),
  );

  async function save() {
    if (!canSave) return;
    await onSave({ text: text.trim(), tagIds });
    setText('');
    setTagIds([]);
  }

  return (
    <section aria-label="Nuova idea" className={styles.newIdea}>
      <div className={styles.inputRow}>
        <label htmlFor="new-idea" className="sr-only">
          Nuova idea
        </label>
        <textarea
          id="new-idea"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save();
          }}
          placeholder="Es. «spiegare perché uso ancora VB.NET, con esempi dal lavoro vero»"
          className={styles.textarea}
        />
        <button
          type="button"
          className={`${styles.mic} ${dictation.phase === 'ascolto' ? styles.micOn : ''}`}
          disabled={!dictation.available || dictation.phase === 'trascrivo'}
          aria-pressed={dictation.phase === 'ascolto'}
          aria-label={dictation.phase === 'ascolto' ? 'Ferma la dettatura' : 'Detta un’idea'}
          title={micTitle(dictation.phase, dictation.available)}
          onClick={dictation.toggle}
        >
          <Icon name="mic" size={18} strokeWidth={2} />
        </button>
      </div>

      <div className={styles.tagRow}>
        <span className={styles.tagLabel}>Argomento</span>
        {tags.map((tag) => {
          const pressed = tagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={pressed}
              className={`${styles.tagChip} ${pressed ? styles.tagChipOn : ''}`}
              onClick={() => setTagIds((ids) => toggleId(ids, tag.id))}
            >
              {tag.name}
            </button>
          );
        })}
        <Button className={styles.save} onClick={() => void save()} disabled={!canSave}>
          {saving ? 'Salvo…' : 'Salva idea'}
        </Button>
      </div>
      {dictation.phase !== 'pronto' ? (
        <p role="status" className={styles.dictationStatus}>
          {dictation.phase === 'ascolto' && dictation.startedAt !== null ? (
            <>
              <span className={styles.recDot} aria-hidden="true" /> In ascolto ·{' '}
              <DictationTimer startedAt={dictation.startedAt} /> · clic sul microfono per finire
            </>
          ) : (
            'Trascrivo con Whisper sul computer…'
          )}
        </p>
      ) : null}
      {dictation.error ? (
        <p role="alert" className={styles.error}>
          {dictation.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}

/** «00:05» dall'inizio dell'ascolto. */
function DictationTimer({ startedAt }: { startedAt: number }) {
  const now = useNow(1000);
  return <span className={styles.timer}>{timerLabel(Math.max(0, now.getTime() - startedAt))}</span>;
}
