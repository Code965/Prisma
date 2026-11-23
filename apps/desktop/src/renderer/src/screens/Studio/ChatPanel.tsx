import { PLATFORM_LABELS, type Variant } from '@prisma-app/shared';
import { useState } from 'react';
import { Icon } from '../../components/icons/Icon';
import {
  useChat,
  useEditWithAi,
  useRestoreRevision,
  useRevisions,
  type DraftValues,
} from '../../hooks/useStudio';
import { errorMessage } from '../../services/api/client';
import { QUICK_INSTRUCTIONS, chatItems, type ChatItem } from '../../services/studio';
import styles from './Chat.module.css';

interface ChatPanelProps {
  contentId: number;
  variant: Variant;
  draft: DraftValues;
  dirty: boolean;
  readOnly: boolean;
}

/** "Modifica scrivendo" (V3Studio): istruzioni all'LLM con il diff di ogni modifica. */
export function ChatPanel({ contentId, variant, draft, dirty, readOnly }: ChatPanelProps) {
  const chat = useChat(contentId);
  const revisions = useRevisions(variant.id);
  const edit = useEditWithAi(contentId);
  const restore = useRestoreRevision(contentId);
  const [input, setInput] = useState('');
  const label = PLATFORM_LABELS[variant.platform];
  const items = chatItems(chat.data ?? [], revisions.data ?? [], variant.id);
  const disabled = readOnly || edit.isPending || restore.isPending;

  function send(instruction: string) {
    const text = instruction.trim();
    if (!text || disabled) return;
    edit.mutate({ variant, draft, dirty, instruction: text });
    setInput('');
  }

  return (
    <aside aria-labelledby="h-chat" className={styles.chat}>
      <div className={styles.head}>
        <h2 id="h-chat" className={styles.title}>
          Modifica scrivendo
        </h2>
        <span className={`${styles.subtitle} mono`}>DeepSeek · bozza su {label}</span>
      </div>

      <div className={styles.messages} aria-live="polite">
        {items.length === 0 && !edit.isPending && (
          <p className={styles.hint}>
            Scrivi cosa cambiare, per esempio «accorcia l’inizio» o «più tecnico». Ogni modifica
            riporta la bozza in revisione e si può annullare.
          </p>
        )}
        {items.map((item) => (
          <Message
            key={item.id}
            item={item}
            canUndo={!disabled && item.isCurrent && item.undoRevisionId !== null}
            onUndo={() =>
              item.undoRevisionId !== null &&
              restore.mutate({ variant, revisionId: item.undoRevisionId })
            }
          />
        ))}
        {edit.isPending && (
          <>
            <div className={styles.user}>{edit.variables?.instruction}</div>
            <p className={styles.pending}>Sto riscrivendo la bozza…</p>
          </>
        )}
        {edit.error || restore.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(edit.error ?? restore.error)}
          </p>
        ) : null}
      </div>

      <div className={styles.quick}>
        {QUICK_INSTRUCTIONS.map((instruction) => (
          <button
            key={instruction}
            type="button"
            className={styles.quickButton}
            disabled={disabled}
            onClick={() => send(instruction.toLowerCase())}
          >
            {instruction}
          </button>
        ))}
      </div>

      <div className={styles.compose}>
        <label htmlFor="chat-in" className="sr-only">
          Chiedi una modifica
        </label>
        <textarea
          id="chat-in"
          rows={2}
          value={input}
          disabled={readOnly}
          placeholder={
            readOnly
              ? 'Bozza in coda: non modificabile'
              : 'Es. «più tecnico», «chiudi con una domanda»'
          }
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          className={styles.input}
        />
        <button
          type="button"
          aria-label="Invia"
          className={styles.send}
          disabled={disabled || !input.trim()}
          onClick={() => send(input)}
        >
          <Icon name="coda" size={16} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}

function Message({
  item,
  canUndo,
  onUndo,
}: {
  item: ChatItem;
  canUndo: boolean;
  onUndo: () => void;
}) {
  if (item.role === 'user') return <div className={styles.user}>{item.text}</div>;
  return (
    <div className={styles.assistant}>
      <p className={styles.assistantText}>{item.text}</p>
      {item.diff.length > 0 && (
        <div className={`${styles.diff} mono`}>
          {item.diff.map((line, index) => (
            <div key={index} className={line.kind === 'del' ? styles.del : styles.add}>
              {line.kind === 'del' ? '−' : '+'} {line.text}
            </div>
          ))}
        </div>
      )}
      <span className={styles.note}>
        Applicato
        {canUndo && (
          <>
            {' · '}
            <button type="button" className={styles.undo} onClick={onUndo}>
              annulla
            </button>
          </>
        )}
      </span>
    </div>
  );
}
