import { TREND_MAX_KEYWORDS, TREND_SOURCE_LABELS } from '@prisma-app/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Icon } from '../../components/icons/Icon';
import { InspirePanel } from '../../components/InspirePanel/InspirePanel';
import { Page } from '../../components/Page/Page';
import { useCreateIdea, useTags } from '../../hooks/useIdeas';
import { useNow } from '../../hooks/useNow';
import { useRefreshTrends, useSaveTrendKeywords, useTrends } from '../../hooks/useTrends';
import { errorMessage } from '../../services/api/client';
import { trendTarget, type InspireTarget } from '../../services/inspire';
import {
  addKeyword,
  cooldownMinutes,
  keywordSuggestions,
  sourceNotes,
  trendCards,
  trendsSubtitle,
  type TrendCard,
} from '../../services/trends';
import styles from './Trend.module.css';

/** Radar dei trend (fase 8a): parole da cercare, trend raggruppati dall'AI, «Crea un'idea». */
export function TrendScreen() {
  const state = useTrends();
  const tags = useTags();
  const refresh = useRefreshTrends();
  const now = useNow(30_000);
  const data = state.data;
  const cards = trendCards(data?.report, tags.data ?? []);
  const wait = cooldownMinutes(data, now);
  const notes = sourceNotes(data?.report);

  return (
    <Page
      title="Trend"
      subtitle={trendsSubtitle(data)}
      actions={
        data && !data.blocked ? (
          <Button
            icon={<Icon name="sparkle" size={16} />}
            disabled={refresh.isPending || wait !== null}
            title={wait !== null ? `Di nuovo tra ${wait} min` : undefined}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? 'Cerco e analizzo…' : 'Aggiorna'}
          </Button>
        ) : null
      }
    >
      <KeywordsPanel keywords={data?.keywords ?? []} tagNames={tags.data ?? []} />

      {(refresh.error ?? state.error) ? (
        <p role="alert" className={styles.error}>
          {errorMessage(refresh.error ?? state.error)}
        </p>
      ) : null}

      {data && cards.length === 0 && (
        <section className={styles.empty} aria-label="Nessun trend">
          <p>
            {data.blocked ??
              (refresh.isPending
                ? 'Cerco su Hacker News, GitHub, dev.to e YouTube, poi l’AI raggruppa i contenuti…'
                : 'Nessun trend ancora: il radar si aggiorna una volta al giorno, o subito con «Aggiorna».')}
          </p>
          {data.blocked?.startsWith('AI') && <Link to="/impostazioni">Apri le Impostazioni</Link>}
        </section>
      )}

      {cards.length > 0 && (
        <section aria-label="Trend" className={styles.grid}>
          {cards.map((card) => (
            <TrendCardView key={card.title} card={card} />
          ))}
        </section>
      )}

      {notes.length > 0 && (
        <p className={styles.notes}>
          {notes.join(' · ')}
          {notes.some((n) => n.includes('Collega un account YouTube')) && (
            <>
              {' '}
              · <Link to="/impostazioni">Collega YouTube</Link>
            </>
          )}
        </p>
      )}
      {cards.length > 0 && (
        <p className={styles.notes}>
          Numeri dalle fonti (ultimi 7 giorni). Crescita, interesse e «per te» sono valutazioni
          dell’AI da 1 a 5.
        </p>
      )}
    </Page>
  );
}

function KeywordsPanel({
  keywords,
  tagNames,
}: {
  keywords: string[];
  tagNames: Array<{ id: number; brandId: number; name: string }>;
}) {
  const save = useSaveTrendKeywords();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const suggestions = keywordSuggestions(keywords, tagNames);

  function add(word: string) {
    const result = addKeyword(keywords, word);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft('');
    save.mutate(result.keywords);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    add(draft);
  }

  return (
    <section className={styles.panel} aria-labelledby="h-radar">
      <div className={styles.panelHead}>
        <h2 id="h-radar" className={styles.sectionTitle}>
          Parole del radar
        </h2>
        <span className={`${styles.meta} mono`}>
          {keywords.length}/{TREND_MAX_KEYWORDS} · meglio in inglese
        </span>
      </div>
      <div className={styles.chips}>
        {keywords.map((word) => (
          <span key={word} className={styles.chip}>
            {word}
            <button
              type="button"
              aria-label={`Togli ${word}`}
              className={styles.chipRemove}
              disabled={save.isPending}
              onClick={() => save.mutate(keywords.filter((k) => k !== word))}
            >
              ×
            </button>
          </span>
        ))}
        {keywords.length < TREND_MAX_KEYWORDS && (
          <form className={styles.addForm} onSubmit={submit}>
            <label htmlFor="trend-word" className="sr-only">
              Nuova parola
            </label>
            <input
              id="trend-word"
              className={styles.input}
              value={draft}
              maxLength={40}
              placeholder="es. rust, typescript, llm"
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              size={32}
              disabled={!draft.trim() || save.isPending}
            >
              Aggiungi
            </Button>
          </form>
        )}
      </div>
      {suggestions.length > 0 && keywords.length < TREND_MAX_KEYWORDS && (
        <div className={styles.suggestions}>
          <span className={styles.meta}>Dai tuoi argomenti:</span>
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              className={styles.suggestion}
              onClick={() => add(name)}
            >
              + {name}
            </button>
          ))}
        </div>
      )}
      {(error ?? save.error) ? (
        <p role="alert" className={styles.error}>
          {error ?? errorMessage(save.error)}
        </p>
      ) : null}
    </section>
  );
}

function TrendCardView({ card }: { card: TrendCard }) {
  const createIdea = useCreateIdea();
  const [added, setAdded] = useState(false);
  const [target, setTarget] = useState<InspireTarget | null>(null);

  return (
    <article className={styles.card}>
      {target && <InspirePanel target={target} onClose={() => setTarget(null)} />}
      <header className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{card.title}</h3>
        {card.tagName && <span className={styles.tag}>#{card.tagName}</span>}
      </header>
      <div className={styles.scores} aria-label="Valutazioni dell’AI">
        {card.scores.map((score) => (
          <span key={score.label} className={styles.score} title={`${score.value} su 5`}>
            <span className={styles.scoreLabel}>{score.label}</span>
            <span className={styles.dots} aria-label={`${score.value} su 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={n <= score.value ? styles.dotOn : styles.dot} />
              ))}
            </span>
          </span>
        ))}
      </div>
      <p className={styles.summary}>{card.summary}</p>
      <p className={styles.why}>{card.why}</p>
      <ul className={styles.items}>
        {card.items.map((item) => (
          <li key={item.id} className={styles.item}>
            <span className={`${styles.source} mono`}>{TREND_SOURCE_LABELS[item.source]}</span>
            <a href={item.url} target="_blank" rel="noreferrer" className={styles.itemLink}>
              {item.title}
            </a>
            {item.signalText && <span className={`${styles.signals} mono`}>{item.signalText}</span>}
            <button
              type="button"
              className={styles.inspire}
              onClick={() => setTarget(trendTarget(item))}
            >
              Ispirati
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.ideaBox}>
        <span className={`${styles.ideaLabel} mono`}>IDEA</span>
        <p className={styles.ideaText}>{card.idea}</p>
        {added ? (
          <Link to="/idee" className={styles.action}>
            Idea aggiunta · apri le idee
          </Link>
        ) : (
          <button
            type="button"
            className={styles.action}
            disabled={createIdea.isPending}
            onClick={() =>
              createIdea.mutate(
                { text: card.idea, tagIds: card.tagId ? [card.tagId] : [] },
                { onSuccess: () => setAdded(true) },
              )
            }
          >
            Crea un’idea
          </button>
        )}
        {createIdea.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(createIdea.error)}
          </p>
        ) : null}
      </div>
    </article>
  );
}
