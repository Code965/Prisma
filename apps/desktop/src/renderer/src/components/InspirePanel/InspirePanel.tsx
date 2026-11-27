import { PLATFORMS, PLATFORM_LABELS, inspirationIdeaText, type Platform } from '@prisma-app/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTags } from '../../hooks/useIdeas';
import { useCreateInspiredIdea, useInspire } from '../../hooks/useInspire';
import { errorMessage } from '../../services/api/client';
import {
  initialPlatforms,
  inspireRequest,
  signalLines,
  type InspireTarget,
  type TopicChoice,
} from '../../services/inspire';
import { togglePlatform } from '../../services/ideas';
import { Button } from '../Button/Button';
import { Icon } from '../icons/Icon';
import { PlatformIcon } from '../PlatformIcon/PlatformIcon';
import styles from './InspirePanel.module.css';

/**
 * «Ispirati» (fase 8c): meccanismo del post d'origine spiegato dall'AI e proposta di un'idea
 * sull'argomento del brand; l'idea si salva con il riferimento e, se richiesto, le bozze.
 */
export function InspirePanel({ target, onClose }: { target: InspireTarget; onClose: () => void }) {
  const tags = useTags().data ?? [];
  const inspire = useInspire();
  const create = useCreateInspiredIdea();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<TopicChoice>({ kind: 'ai' });
  const [text, setText] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(() => initialPlatforms(target));
  const proposal = inspire.data;
  const busy = inspire.isPending || create.isPending;

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [busy, onClose]);

  function analyze() {
    create.reset();
    inspire.mutate(inspireRequest(target, topic), {
      onSuccess: (result) => setText(inspirationIdeaText(result)),
    });
  }

  function save(drafts: boolean) {
    if (!proposal) return;
    create.mutate(
      { proposal, text, platforms, drafts },
      { onSuccess: ({ content }) => content && navigate(`/studio/${content.id}`) },
    );
  }

  const topicValue =
    topic.kind === 'tag' ? `tag:${topic.tagId}` : topic.kind === 'testo' ? 'testo' : 'ai';
  const signals = signalLines(proposal?.signals ?? null);
  const error = inspire.error ?? create.error;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="inspire-title">
      <section className={styles.card}>
        <header className={styles.header}>
          <Icon name="sparkle" size={16} />
          <h2 id="inspire-title" className={styles.title}>
            Ispirati
          </h2>
          <button type="button" className={styles.close} disabled={busy} onClick={onClose}>
            Chiudi
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.origin}>
            {target.platform && <PlatformIcon platform={target.platform} size={24} />}
            <div className={styles.originText}>
              <span className={`${styles.label} mono`}>{target.label}</span>
              {target.url ? (
                <a href={target.url} target="_blank" rel="noreferrer" className={styles.link}>
                  {target.title || 'Post'}
                </a>
              ) : (
                <span>{target.title}</span>
              )}
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Argomento dell’idea</span>
              <select
                className={styles.input}
                value={topicValue}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  setTopic(
                    value === 'ai'
                      ? { kind: 'ai' }
                      : value === 'testo'
                        ? { kind: 'testo', text: '' }
                        : { kind: 'tag', tagId: Number(value.slice(4)) },
                  );
                }}
              >
                <option value="ai">
                  {tags.length > 0 ? 'Lo sceglie l’AI tra i tuoi argomenti' : 'Lo sceglie l’AI'}
                </option>
                {tags.map((tag) => (
                  <option key={tag.id} value={`tag:${tag.id}`}>
                    {tag.name}
                  </option>
                ))}
                <option value="testo">Scrivo un argomento…</option>
              </select>
            </label>
            {topic.kind === 'testo' && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Il tuo argomento</span>
                <input
                  className={styles.input}
                  maxLength={80}
                  value={topic.text}
                  disabled={busy}
                  placeholder="es. Kubernetes in locale"
                  onChange={(event) => setTopic({ kind: 'testo', text: event.target.value })}
                />
              </label>
            )}
            <Button
              variant={proposal ? 'secondary' : 'primary'}
              icon={<Icon name="sparkle" size={16} />}
              disabled={busy || (topic.kind === 'testo' && !topic.text.trim())}
              onClick={analyze}
            >
              {inspire.isPending ? 'Analizzo…' : proposal ? 'Rigenera' : 'Analizza il post'}
            </Button>
          </div>
          <p className={styles.note}>
            Si riusa la forma, non il testo: l’AI non può riprendere frasi dell’originale.
          </p>

          {proposal && (
            <div className={styles.result}>
              <section className={styles.block}>
                <h3 className={`${styles.blockTitle} mono`}>MECCANISMO</h3>
                <dl className={styles.mechanism}>
                  <dt>Apertura</dt>
                  <dd>{proposal.mechanism.hook}</dd>
                  <dt>Struttura</dt>
                  <dd>
                    <ol className={styles.steps}>
                      {proposal.mechanism.structure.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </dd>
                  <dt>Perché ha funzionato</dt>
                  <dd>{proposal.mechanism.whyItWorked}</dd>
                </dl>
                {signals.length > 0 && (
                  <p className={`${styles.signals} mono`}>{signals.join(' · ')}</p>
                )}
              </section>

              <section className={styles.block}>
                <h3 className={`${styles.blockTitle} mono`}>LA TUA IDEA · {proposal.idea.topic}</h3>
                <textarea
                  className={styles.textarea}
                  value={text}
                  maxLength={4000}
                  rows={9}
                  disabled={busy}
                  aria-label="Testo dell’idea"
                  onChange={(event) => setText(event.target.value)}
                />
                <div className={styles.platforms} role="group" aria-label="Piattaforme">
                  {PLATFORMS.map((platform) => (
                    <label key={platform} className={styles.platform}>
                      <input
                        type="checkbox"
                        checked={platforms.includes(platform)}
                        disabled={busy}
                        onChange={() => setPlatforms(togglePlatform(platforms, platform))}
                      />
                      {PLATFORM_LABELS[platform]}
                    </label>
                  ))}
                </div>
              </section>
            </div>
          )}

          {error ? (
            <p role="alert" className={styles.error}>
              {errorMessage(error)}
            </p>
          ) : null}
        </div>

        {proposal && (
          <footer className={styles.footer}>
            {create.data && !create.data.content ? (
              <Link to="/idee" className={styles.saved}>
                Idea salvata · apri le Idee
              </Link>
            ) : (
              <span className={styles.note}>
                Le bozze restano da approvare: niente si pubblica da solo.
              </span>
            )}
            <Button
              variant="secondary"
              disabled={busy || Boolean(create.data)}
              onClick={() => save(false)}
            >
              Crea l’idea
            </Button>
            <Button
              disabled={busy || platforms.length === 0 || Boolean(create.data)}
              onClick={() => save(true)}
            >
              {create.isPending && create.variables?.drafts ? 'Scrivo le bozze…' : 'Crea le bozze'}
            </Button>
          </footer>
        )}
      </section>
    </div>
  );
}
