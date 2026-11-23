import type { ManualMetricsRow } from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useSaveManualMetrics } from '../../hooks/useAnalytics';
import {
  LINKEDIN_FIELDS,
  linkedinDraft,
  manualInput,
  manualSummary,
  type LinkedInDraft,
} from '../../services/analytics';
import { errorMessage } from '../../services/api/client';
import { whenLabel } from '../../services/calendar';
import styles from './Analytics.module.css';

/**
 * LinkedIn non espone metriche alle app self-serve: per i post degli ultimi 90 giorni si
 * inseriscono a mano i numeri letti sul post (entrano nei grafici e nella classifica).
 */
export function LinkedInMetricsPanel({ rows }: { rows: readonly ManualMetricsRow[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="h-linkedin" className={styles.manual}>
      <h2 id="h-linkedin" className={styles.sectionTitle}>
        Metriche LinkedIn da inserire
      </h2>
      <p className={styles.manualHint}>
        LinkedIn non le dà alle app personali: copia i numeri dal post («Visualizza statistiche»).
      </p>
      {rows.map((row) => (
        <div key={row.publicationId} className={styles.manualRow}>
          <div className={styles.manualHead}>
            <div className={styles.topText}>
              <span className={styles.topTitle}>{row.title}</span>
              <span className={styles.topFormat}>
                {whenLabel(row.publishedAt)} · {manualSummary(row.metrics)}
              </span>
            </div>
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={openId === row.publicationId}
              onClick={() => setOpenId(openId === row.publicationId ? null : row.publicationId)}
            >
              {openId === row.publicationId ? 'Chiudi' : row.metrics ? 'Aggiorna' : 'Inserisci'}
            </button>
          </div>
          {openId === row.publicationId && <ManualForm row={row} onDone={() => setOpenId(null)} />}
        </div>
      ))}
    </section>
  );
}

function ManualForm({ row, onDone }: { row: ManualMetricsRow; onDone: () => void }) {
  const [draft, setDraft] = useState<LinkedInDraft>(() => linkedinDraft(row.metrics));
  const save = useSaveManualMetrics();
  const input = manualInput(draft);
  return (
    <form
      className={styles.manualForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (input) save.mutate({ publicationId: row.publicationId, input }, { onSuccess: onDone });
      }}
    >
      {LINKEDIN_FIELDS.map(([key, label]) => (
        <label key={key} className={styles.field}>
          <span>{label}</span>
          <input
            inputMode="numeric"
            className={styles.input}
            value={draft[key]}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          />
        </label>
      ))}
      <div className={styles.formActions}>
        <Button size={32} type="submit" disabled={!input || save.isPending}>
          {save.isPending ? 'Salvo…' : 'Salva'}
        </Button>
        {row.externalUrl && (
          <a href={row.externalUrl} target="_blank" rel="noreferrer" className={styles.linkButton}>
            Apri il post
          </a>
        )}
      </div>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      ) : null}
    </form>
  );
}
