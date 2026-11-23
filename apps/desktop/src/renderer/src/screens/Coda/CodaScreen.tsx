import { PLATFORM_LABELS, STATUS_DISPLAY, type PublicationView } from '@prisma-app/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useContents, usePublications } from '../../hooks/useCalendar';
import { useNow } from '../../hooks/useNow';
import {
  useCancelPublication,
  usePublishNow,
  useQueueChecks,
  useRetryPublication,
} from '../../hooks/useQueue';
import { errorMessage } from '../../services/api/client';
import {
  checkChips,
  countdown,
  captionFor,
  countdownLabel,
  isInboxDelivery,
  logStatusLabel,
  logDetail,
  logPublications,
  logWhen,
  nextRunAt,
  queueSubtitle,
  queueSummary,
  queuedPublications,
  waitingDrafts,
} from '../../services/queue';
import styles from './Coda.module.css';

/** Coda di pubblicazione (V3Coda): post in uscita con conto alla rovescia, controlli e log. */
export function CodaScreen() {
  const now = useNow(1000);
  const publications = usePublications();
  const contents = useContents();
  const checks = useQueueChecks();
  const publishNow = usePublishNow();
  const cancel = useCancelPublication();
  const retry = useRetryPublication();
  const [copied, setCopied] = useState<number | null>(null);

  async function copyCaption(publicationId: number, caption: string) {
    await navigator.clipboard.writeText(caption);
    setCopied(publicationId);
  }

  const queued = queuedPublications(publications.data ?? []);
  const log = logPublications(publications.data ?? []);
  const checksById = new Map((checks.data ?? []).map((c) => [c.publicationId, c.checks]));
  const actionError = publishNow.error ?? cancel.error ?? retry.error;

  function confirmPublishNow(publication: PublicationView) {
    const label = PLATFORM_LABELS[publication.platform];
    if (window.confirm(`Pubblicare subito «${publication.contentTitle}» su ${label}?`)) {
      publishNow.mutate(publication.id);
    }
  }

  function confirmCancel(publication: PublicationView) {
    if (
      window.confirm(`Togliere «${publication.contentTitle}» dalla coda? La bozza resta approvata.`)
    ) {
      cancel.mutate(publication.id);
    }
  }

  return (
    <Page
      title="Coda di pubblicazione"
      subtitle={queueSummary(queued.length, waitingDrafts(contents.data ?? []))}
      actions={
        <Link to="/calendario" className={styles.secondaryLink}>
          Vai al calendario
        </Link>
      }
    >
      {actionError ? (
        <p role="alert" className={styles.error}>
          {errorMessage(actionError)}
        </p>
      ) : null}
      {publications.error ? (
        <Panel label="Errore">
          <p role="alert" className={styles.error}>
            {errorMessage(publications.error)}
          </p>
        </Panel>
      ) : null}

      <section aria-label="Post in uscita" className={styles.queue}>
        {queued.map((publication) => {
          const sending = publication.status === 'in_pubblicazione';
          return (
            <article key={publication.id} className={styles.card}>
              <div className={styles.cardTop}>
                <PlatformIcon platform={publication.platform} size={32} />
                <div className={styles.cardText}>
                  <h2 className={styles.cardTitle}>{publication.contentTitle}</h2>
                  <span className={styles.muted}>{queueSubtitle(publication)}</span>
                </div>
                <div className={styles.countdown}>
                  <span className={styles.countdownLabel}>
                    {sending ? 'stato' : countdownLabel(publication)}
                  </span>
                  <span className={`${styles.countdownValue} mono`}>
                    {sending ? 'in invio…' : countdown(nextRunAt(publication), now)}
                  </span>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={sending || publishNow.isPending}
                    onClick={() => confirmPublishNow(publication)}
                  >
                    Pubblica ora
                  </button>
                  <Link to="/calendario" className={styles.smallLink}>
                    Sposta
                  </Link>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    disabled={sending || cancel.isPending}
                    onClick={() => confirmCancel(publication)}
                  >
                    Annulla
                  </button>
                </div>
              </div>
              <div className={styles.checks}>
                {checkChips(checksById.get(publication.id) ?? []).map((chip, index) => (
                  <span
                    key={index}
                    className={styles.check}
                    style={{
                      background: `var(--s-${chip.token}Bg)`,
                      color: `var(--s-${chip.token})`,
                    }}
                  >
                    <span className={`${styles.checkMark} mono`}>{chip.mark}</span>
                    {chip.text}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
        {publications.data && queued.length === 0 && (
          <p className={styles.empty}>
            Coda vuota. Approva un contenuto e pianificalo per vederlo qui.
          </p>
        )}
      </section>

      <section aria-labelledby="h-log" className={styles.log}>
        <h2 id="h-log" className={styles.logTitle}>
          Log delle pubblicazioni
        </h2>
        {log.length === 0 && <p className={styles.muted}>Ancora nessuna pubblicazione.</p>}
        {log.map((publication) => {
          const status = STATUS_DISPLAY[publication.status];
          const detail = logDetail(publication);
          const caption = isInboxDelivery(publication)
            ? captionFor(contents.data ?? [], publication)
            : null;
          return (
            <div key={publication.id} className={styles.logRow}>
              <span className={`${styles.logWhen} mono`}>{logWhen(publication)}</span>
              <PlatformIcon platform={publication.platform} size={22} />
              <div className={styles.logText}>
                <span className={styles.logName}>{publication.contentTitle}</span>
                <span
                  className={`${styles.logDetail} mono`}
                  style={{ color: detail.isError ? 'var(--s-err)' : 'var(--muted)' }}
                >
                  {detail.text}
                </span>
              </div>
              <span
                className={styles.statusChip}
                style={{
                  background: `var(--s-${status.token}Bg)`,
                  color: `var(--s-${status.token})`,
                }}
              >
                <span className={styles.dot} />
                {logStatusLabel(publication)}
              </span>
              {caption !== null && (
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={() => void copyCaption(publication.id, caption)}
                >
                  {copied === publication.id ? 'Copiata' : 'Copia didascalia'}
                </button>
              )}
              {publication.status === 'errore' && (
                <button
                  type="button"
                  className={styles.retryButton}
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(publication.id)}
                >
                  Riprova
                </button>
              )}
              {publication.status === 'pubblicato' && publication.externalUrl && (
                <a
                  href={publication.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.openButton}
                >
                  Apri post
                </a>
              )}
            </div>
          );
        })}
      </section>
    </Page>
  );
}
