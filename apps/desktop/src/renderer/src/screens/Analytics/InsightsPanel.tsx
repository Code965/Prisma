import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGenerateInsights, useInsights } from '../../hooks/useAnalytics';
import { useCreateIdea } from '../../hooks/useIdeas';
import { errorMessage } from '../../services/api/client';
import { insightCards, insightsSubtitle } from '../../services/insights';
import styles from './Analytics.module.css';

/** «Suggerimenti dell'AI» del mockup: argomenti, orari e formati, aggiornati ogni lunedì. */
export function InsightsPanel() {
  const state = useInsights();
  const generate = useGenerateInsights();
  const createIdea = useCreateIdea();
  const [ideaAdded, setIdeaAdded] = useState(false);
  const cards = insightCards(state.data);
  const blocked = state.data?.blocked ?? null;

  return (
    <>
      <div className={styles.aiHead}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" />
        </svg>
        <h2 id="h-ai" className={styles.sectionTitle}>
          Suggerimenti dell&apos;AI
        </h2>
        <span className={`${styles.aiMeta} mono`}>{insightsSubtitle(state.data)}</span>
        {!blocked && state.data && (
          <button
            type="button"
            className={`${styles.linkButton} ${styles.aiRefresh}`}
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? 'Analizzo…' : 'Aggiorna'}
          </button>
        )}
      </div>

      {cards.map((card) => (
        <article key={card.kind} className={styles.tip}>
          <span className={`${styles.tipKind} mono`}>{card.label}</span>
          <p className={styles.tipText}>{card.text}</p>
          <span className={styles.tipWhy}>{card.why}</span>
          {card.action.kind === 'idea' ? (
            ideaAdded ? (
              <Link to="/idee" className={styles.tipAction}>
                Idea aggiunta · apri le idee
              </Link>
            ) : (
              <button
                type="button"
                className={styles.tipAction}
                disabled={createIdea.isPending}
                title={card.action.idea}
                onClick={() =>
                  card.action.kind === 'idea' &&
                  createIdea.mutate(
                    { text: card.action.idea, tagIds: [] },
                    { onSuccess: () => setIdeaAdded(true) },
                  )
                }
              >
                {card.action.label}
              </button>
            )
          ) : (
            <Link to={card.action.to} className={styles.tipAction}>
              {card.action.label}
            </Link>
          )}
        </article>
      ))}

      {cards.length === 0 && state.data && (
        <article className={styles.tip}>
          <span className={`${styles.tipKind} mono`}>{blocked ? 'NON ANCORA' : 'PRONTI'}</span>
          <p className={styles.tipText}>
            {blocked ??
              'Ci sono abbastanza dati: i suggerimenti arrivano lunedì, o subito con «Genera ora».'}
          </p>
          {!blocked && (
            <button
              type="button"
              className={styles.tipAction}
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Analizzo…' : 'Genera ora'}
            </button>
          )}
        </article>
      )}

      {(generate.error ?? createIdea.error ?? state.error) ? (
        <p role="alert" className={styles.error}>
          {errorMessage(generate.error ?? createIdea.error ?? state.error)}
        </p>
      ) : null}
    </>
  );
}
