import type { Variant } from '@prisma-app/shared';
import { useState } from 'react';
import { Icon } from '../../components/icons/Icon';
import { useEditCarousel } from '../../hooks/useCarousel';
import { errorMessage } from '../../services/api/client';
import styles from './Carosello.module.css';

/** Messaggio della conversazione sulle slide (tenuta in memoria finché l'editor è aperto). */
export interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  proposals?: string[];
}

interface CarouselChatProps {
  contentId: number;
  variant: Variant;
  index: number;
  dirty: boolean;
  readOnly: boolean;
  entries: ChatEntry[];
  onEntries: (update: (entries: ChatEntry[]) => ChatEntry[]) => void;
  onUseTitle: (title: string) => void;
}

let nextId = 1;

/**
 * «Modifica la slide scrivendo»: l'LLM cambia le slide (salvate, la bozza torna in revisione)
 * oppure propone titoli da usare con un clic. Lavora sulla versione salvata, quindi con
 * modifiche locali in sospeso chiede di salvarle prima.
 */
export function CarouselChat(props: CarouselChatProps) {
  const { variant, index, dirty, readOnly, entries, onEntries } = props;
  const edit = useEditCarousel(props.contentId);
  const [text, setText] = useState('');
  const blocked = readOnly || dirty || edit.isPending;

  function send() {
    const instruction = text.trim();
    if (!instruction || blocked) return;
    setText('');
    onEntries((list) => [...list, { id: nextId++, role: 'user', text: instruction }]);
    edit.mutate(
      { variant, instruction, slideIndex: index },
      {
        onSuccess: (result) =>
          onEntries((list) => [
            ...list,
            { id: nextId++, role: 'assistant', text: result.reply, proposals: result.proposals },
          ]),
      },
    );
  }

  return (
    <section aria-labelledby="h-chat2" className={`${styles.panel} ${styles.chat}`}>
      <div className={styles.chatHead}>
        <h2 id="h-chat2" className={styles.panelTitle}>
          Modifica la slide scrivendo
        </h2>
        <span className={`${styles.chatContext} mono`}>DeepSeek · contesto: slide {index + 1}</span>
      </div>

      {entries.length === 0 && (
        <p className={styles.note}>
          Per esempio «meno testo», «aggiungi un esempio» o «proponi tre titoli più incisivi».
        </p>
      )}
      {entries.map((entry) =>
        entry.role === 'user' ? (
          <div key={entry.id} className={styles.userMessage}>
            {entry.text}
          </div>
        ) : (
          <div key={entry.id} className={styles.assistantMessage}>
            <p className={styles.assistantText}>{entry.text}</p>
            {entry.proposals?.map((proposal) => (
              <button
                key={proposal}
                type="button"
                className={styles.proposal}
                disabled={readOnly}
                onClick={() => props.onUseTitle(proposal)}
              >
                <span className={styles.proposalText}>{proposal}</span>
                <span className={styles.proposalUse}>Usa</span>
              </button>
            ))}
          </div>
        ),
      )}
      {edit.isPending && <p className={styles.note}>DeepSeek sta scrivendo…</p>}
      {edit.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(edit.error)}
        </p>
      ) : null}
      {dirty && !readOnly && (
        <p className={styles.note}>Salva le modifiche per chiedere altro a DeepSeek.</p>
      )}

      <form
        className={styles.compose}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor="sl-chat" className={styles.srOnly}>
          Chiedi una modifica alla slide
        </label>
        <input
          id="sl-chat"
          className={styles.composeInput}
          value={text}
          maxLength={1000}
          disabled={blocked}
          placeholder="Es. «meno testo», «aggiungi un esempio»"
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          aria-label="Invia"
          className={styles.send}
          disabled={blocked || !text.trim()}
        >
          <Icon name="coda" size={16} strokeWidth={2} />
        </button>
      </form>
    </section>
  );
}
