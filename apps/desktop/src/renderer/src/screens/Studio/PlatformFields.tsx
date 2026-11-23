import type { Platform, VariantMetadata } from '@prisma-app/shared';
import type { DraftValues } from '../../hooks/useStudio';
import { TEXT_LIMITS, charCount, formatCount } from '../../services/studio';
import { HashtagEditor } from './HashtagEditor';
import styles from './Studio.module.css';

interface PlatformFieldsProps {
  platform: Platform;
  draft: DraftValues;
  readOnly: boolean;
  onChange: (draft: DraftValues) => void;
}

/** Campi specifici per piattaforma (V3Studio): testo, primo commento, titolo, descrizione, hashtag. */
export function PlatformFields({ platform, draft, readOnly, onChange }: PlatformFieldsProps) {
  const setBody = (body: string) => onChange({ ...draft, body });
  const setMeta = (patch: Partial<VariantMetadata>) =>
    onChange({ ...draft, metadata: { ...draft.metadata, ...patch } });
  const hashtags = (
    <HashtagEditor
      platform={platform}
      tags={draft.metadata.hashtags}
      readOnly={readOnly}
      onChange={(next) => setMeta({ hashtags: next })}
    />
  );

  if (platform === 'linkedin') {
    return (
      <div className={styles.fieldStack}>
        <TextArea
          id="li-text"
          label="Testo del post"
          rows={9}
          value={draft.body}
          limit={TEXT_LIMITS.linkedin.body}
          readOnly={readOnly}
          onChange={setBody}
        />
        <TextInput
          id="li-first"
          label="Primo commento"
          value={draft.metadata.firstComment ?? ''}
          placeholder="Link o approfondimento, pubblicato come primo commento"
          readOnly={readOnly}
          onChange={(value) => setMeta({ firstComment: value || undefined })}
        />
        {hashtags}
        <PhaseNote text="Con le slide il post esce come carosello PDF: esportalo e caricalo su R2 dall’editor carosello." />
      </div>
    );
  }

  if (platform === 'instagram') {
    return (
      <div className={styles.fieldStack}>
        <TextArea
          id="ig-cap"
          label="Caption"
          rows={6}
          value={draft.body}
          limit={TEXT_LIMITS.instagram.body}
          readOnly={readOnly}
          onChange={setBody}
        />
        {hashtags}
        <PhaseNote text="Le immagini arrivano dalle slide: esportale in JPG e caricale su R2 dall’editor carosello." />
      </div>
    );
  }

  if (platform === 'tiktok') {
    return (
      <div className={styles.fieldStack}>
        <TextArea
          id="tt-cap"
          label="Caption"
          rows={3}
          value={draft.body}
          limit={TEXT_LIMITS.tiktok.body}
          readOnly={readOnly}
          onChange={setBody}
        />
        {hashtags}
        <PhaseNote text="Video, copertina e impostazioni di visibilità: arrivano con la fase 3." />
      </div>
    );
  }

  if (platform === 'blog') {
    return (
      <div className={styles.fieldStack}>
        <TextInput
          id="bl-title"
          label="Titolo"
          value={draft.metadata.title ?? ''}
          limit={TEXT_LIMITS.blog.title}
          readOnly={readOnly}
          onChange={(value) => setMeta({ title: value || undefined })}
        />
        <TextArea
          id="bl-excerpt"
          label="Estratto (meta description)"
          rows={3}
          value={draft.metadata.description ?? ''}
          limit={TEXT_LIMITS.blog.description}
          readOnly={readOnly}
          onChange={(value) => setMeta({ description: value || undefined })}
        />
        <TextArea
          id="bl-html"
          label="Articolo (HTML)"
          rows={16}
          mono
          value={draft.body}
          limit={TEXT_LIMITS.blog.body}
          readOnly={readOnly}
          onChange={setBody}
        />
        {hashtags}
        <PhaseNote text="Immagine di copertina: arriva con la fase 2." />
      </div>
    );
  }

  return (
    <div className={styles.fieldStack}>
      <TextInput
        id="yt-title"
        label="Titolo"
        value={draft.metadata.title ?? ''}
        limit={TEXT_LIMITS.youtube.title}
        readOnly={readOnly}
        onChange={(value) => setMeta({ title: value || undefined })}
      />
      <TextArea
        id="yt-desc"
        label="Descrizione e capitoli"
        rows={8}
        mono
        value={draft.metadata.description ?? ''}
        limit={TEXT_LIMITS.youtube.description}
        readOnly={readOnly}
        onChange={(value) => setMeta({ description: value || undefined })}
      />
      <TextArea
        id="yt-post"
        label="Post della community"
        rows={3}
        value={draft.body}
        limit={TEXT_LIMITS.youtube.body}
        readOnly={readOnly}
        onChange={setBody}
      />
      {hashtags}
      <PhaseNote text="Video, miniatura, visibilità e playlist: arrivano con la fase 3." />
    </div>
  );
}

function Counter({ value, limit }: { value: string; limit: number }) {
  const count = charCount(value);
  return (
    <span className={`${styles.counter} mono`} data-over={count > limit || undefined}>
      {formatCount(count, limit)}
    </span>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  limit?: number;
  readOnly: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}

function TextArea({ rows, mono, ...field }: FieldProps & { rows: number; mono?: boolean }) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <label htmlFor={field.id} className={styles.fieldLabel}>
          {field.label}
        </label>
        {field.limit !== undefined && <Counter value={field.value} limit={field.limit} />}
      </div>
      <textarea
        id={field.id}
        rows={rows}
        value={field.value}
        readOnly={field.readOnly}
        placeholder={field.placeholder}
        onChange={(event) => field.onChange(event.target.value)}
        className={`${styles.textarea} ${mono ? `${styles.textareaMono} mono` : ''}`}
      />
    </div>
  );
}

function TextInput(field: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <label htmlFor={field.id} className={styles.fieldLabel}>
          {field.label}
        </label>
        {field.limit !== undefined && <Counter value={field.value} limit={field.limit} />}
      </div>
      <input
        id={field.id}
        type="text"
        value={field.value}
        readOnly={field.readOnly}
        placeholder={field.placeholder}
        onChange={(event) => field.onChange(event.target.value)}
        className={styles.input}
      />
    </div>
  );
}

function PhaseNote({ text }: { text: string }) {
  return <p className={styles.phaseNote}>{text}</p>;
}
