import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { useContents, useDeleteContent } from '../../hooks/useCalendar';
import { useNow } from '../../hooks/useNow';
import { errorMessage } from '../../services/api/client';
import {
  CONTENT_FILTERS,
  CONTENT_FILTER_LABELS,
  filterContents,
  filterCounts,
  neverPublished,
  type ContentFilter,
} from '../../services/content-list';
import { relativeDay } from '../../services/dates';
import { sortVariants } from '../../services/studio';
import styles from './ContentList.module.css';

/**
 * «Studio contenuto» senza un contenuto aperto: tutti i contenuti del brand con lo stato per
 * piattaforma e i filtri. Un clic apre lo Studio; si eliminano solo quelli mai usciti.
 */
export function ContentList() {
  const contents = useContents();
  const remove = useDeleteContent();
  const now = useNow();
  const [filter, setFilter] = useState<ContentFilter>('tutti');
  const all = contents.data ?? [];
  const counts = filterCounts(all);
  const shown = filterContents(all, filter);

  return (
    <Page
      title="Studio contenuto"
      subtitle="Tutti i contenuti, anche quelli nati da idee eliminate. Apri un contenuto per modificarne le bozze."
      maxWidth={1100}
    >
      <div role="group" aria-label="Filtra per stato" className={styles.filters}>
        {CONTENT_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === filter}
            className={`${styles.filter} ${option === filter ? styles.filterOn : ''}`}
            onClick={() => setFilter(option)}
          >
            {CONTENT_FILTER_LABELS[option]} <span className="mono">{counts[option]}</span>
          </button>
        ))}
      </div>

      {contents.isLoading && <Panel label="Caricamento">Carico i contenuti…</Panel>}
      {contents.error || remove.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(contents.error ?? remove.error)}
        </p>
      ) : null}
      {contents.data && shown.length === 0 && (
        <Panel label="Nessun contenuto">
          <p className={styles.empty}>
            {all.length === 0
              ? 'Ancora nessun contenuto: parti da un’idea con «Genera contenuti».'
              : 'Nessun contenuto con questo stato.'}
          </p>
        </Panel>
      )}

      <ul className={styles.list}>
        {shown.map((content) => (
          <li key={content.id} className={styles.row}>
            <Link to={`/studio/${content.id}`} className={styles.main}>
              <span className={styles.title}>{content.title}</span>
              <span className={styles.meta}>
                aggiornato {relativeDay(content.updatedAt, now)}
                {content.ideaId === null ? ' · senza idea' : ''}
              </span>
            </Link>
            <div className={styles.variants}>
              {sortVariants(content.variants).map((variant) => (
                <span key={variant.id} className={styles.variant}>
                  <PlatformIcon platform={variant.platform} size={22} />
                  <StatusPill status={variant.status} short />
                </span>
              ))}
            </div>
            {neverPublished(content) && (
              <button
                type="button"
                className={styles.delete}
                disabled={remove.isPending}
                onClick={() =>
                  window.confirm(`Eliminare «${content.title}» con tutte le sue bozze?`) &&
                  remove.mutate(content.id)
                }
              >
                Elimina
              </button>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
