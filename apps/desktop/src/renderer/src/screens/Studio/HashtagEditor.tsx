import { PLATFORM_CODES, type Platform } from '@prisma-app/shared';
import { useState } from 'react';
import { Icon } from '../../components/icons/Icon';
import { normalizeHashtag } from '../../services/studio';
import styles from './Studio.module.css';

interface HashtagEditorProps {
  platform: Platform;
  tags: string[];
  readOnly: boolean;
  onChange: (tags: string[]) => void;
}

/** Hashtag come pill nel colore tenue della piattaforma; si aggiungono con Invio. */
export function HashtagEditor({ platform, tags, readOnly, onChange }: HashtagEditorProps) {
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const background = `var(--${PLATFORM_CODES[platform]}Soft)`;

  function add() {
    if (!input.trim()) return;
    const tag = normalizeHashtag(input);
    if (!tag) {
      setInvalid(true);
      return;
    }
    if (!tags.includes(tag)) onChange([...tags, tag]);
    setInput('');
    setInvalid(false);
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Hashtag</span>
      <div className={styles.hashtags}>
        {tags.map((tag) => (
          <span key={tag} className={styles.hashtag} style={{ background }}>
            {tag}
            {!readOnly && (
              <button
                type="button"
                className={styles.hashtagRemove}
                aria-label={`Togli ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
              >
                <Icon name="close" size={11} strokeWidth={2.4} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            aria-label="Aggiungi hashtag"
            className={styles.hashtagInput}
            data-invalid={invalid || undefined}
            value={input}
            placeholder="+ hashtag"
            onChange={(event) => {
              setInput(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
        )}
      </div>
      {invalid && (
        <span className={styles.error}>Solo lettere, numeri e trattino basso, senza spazi.</span>
      )}
    </div>
  );
}
