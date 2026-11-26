import {
  PLATFORMS,
  PLATFORM_CODES,
  PLATFORM_LABELS,
  STATUS_DISPLAY,
  type Platform,
} from '@prisma-app/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons/Icon';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useBrand } from '../../hooks/brand';
import { useSocialAccounts } from '../../hooks/useAccounts';
import { usePublications } from '../../hooks/useCalendar';
import { useIdeas } from '../../hooks/useIdeas';
import { useNow } from '../../hooks/useNow';
import { accountRows } from '../../services/accounts';
import { placePublications } from '../../services/calendar';
import { useWeekSummary } from '../../hooks/useAnalytics';
import {
  greeting,
  longDate,
  weekMetricCards,
  weekStrip,
  weekTitle,
} from '../../services/dashboard';
import { visibleIdeas } from '../../services/ideas';
import { countdownShort, nextRunAt, queuedPublications, queueSubtitle } from '../../services/queue';
import { startOfWeek, zonedParts } from '../../services/zoned-time';
import styles from './Dashboard.module.css';

const ALL_PLATFORMS = new Set(PLATFORMS);
const NEXT_LIMIT = 5;
const IDEAS_LIMIT = 4;

/** Dashboard (V3Dashboard): settimana, prossime uscite, account, metriche e idee in coda. */
export function DashboardScreen() {
  const summary = useWeekSummary();
  const now = useNow(30_000);
  const { brand } = useBrand();
  const publications = usePublications();
  const accounts = useSocialAccounts();
  const ideas = useIdeas();

  const weekStart = startOfWeek(zonedParts(now).day);
  const strip = weekStrip(
    weekStart,
    placePublications(publications.data ?? [], ALL_PLATFORMS),
    now,
  );
  const next = queuedPublications(publications.data ?? []).slice(0, NEXT_LIMIT);
  const rows = accountRows(accounts.data ?? [], now);
  const allIdeas = visibleIdeas(ideas.data ?? []).filter((idea) => idea.status === 'nuova');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.date}>{longDate(now)}</span>
          <h1 className={styles.title}>{greeting(now, brand?.name)}</h1>
        </div>
        <Link to="/idee" className={styles.primaryLink}>
          <Icon name="idee" size={14} strokeWidth={2} />
          Nuova idea
        </Link>
      </header>

      <section aria-labelledby="h-sett" className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 id="h-sett" className={styles.panelTitle}>
            Settimana in corso · {weekTitle(weekStart)}
          </h2>
          <Link to="/calendario" className={styles.link}>
            Apri calendario
          </Link>
        </div>
        <div
          role="region"
          aria-label="Post della settimana"
          tabIndex={0}
          className={styles.scroller}
        >
          <div className={styles.week}>
            {strip.map((day) => (
              <div
                key={day.day}
                className={styles.day}
                data-today={day.isToday || undefined}
                data-past={day.isPast || undefined}
                data-weekend={day.isWeekend || undefined}
                style={dayStyle(day.platforms)}
              >
                {day.platforms.length > 0 ? (
                  <span aria-hidden className={styles.stripes}>
                    {day.platforms.map((platform) => (
                      <span
                        key={platform}
                        style={{ background: `var(--${PLATFORM_CODES[platform]})` }}
                      />
                    ))}
                  </span>
                ) : null}
                <span className={styles.dayLabel}>{day.label}</span>
                {day.posts.map(({ publication, time }) => {
                  const status = STATUS_DISPLAY[publication.status];
                  return (
                    <span
                      key={publication.id}
                      className={styles.pill}
                      style={{ background: `var(--s-${status.token}Bg)` }}
                      title={publication.contentTitle}
                    >
                      <PlatformIcon platform={publication.platform} size={16} />
                      <span className={`${styles.pillTime} mono`}>{time}</span>
                      <span
                        className={styles.pillStatus}
                        style={{ color: `var(--s-${status.token})` }}
                      >
                        {status.short}
                      </span>
                    </span>
                  );
                })}
                {day.posts.length === 0 && !day.isPast ? (
                  <Link to="/calendario" className={styles.plan}>
                    + Pianifica
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className={styles.row}>
        <section aria-labelledby="h-next" className={`${styles.list} ${styles.wide}`}>
          <div className={styles.listHead}>
            <h2 id="h-next" className={styles.panelTitle}>
              Prossime pubblicazioni
            </h2>
            <Link to="/coda" className={styles.link}>
              Coda
            </Link>
          </div>
          {next.length === 0 && <p className={styles.empty}>Nessun post in uscita.</p>}
          {next.map((publication) => {
            const status = STATUS_DISPLAY[publication.status];
            return (
              <div key={publication.id} className={styles.listRow}>
                <PlatformIcon platform={publication.platform} size={28} />
                <div className={styles.listText}>
                  <span className={styles.ellipsis}>{publication.contentTitle}</span>
                  <span className={styles.muted}>{queueSubtitle(publication)}</span>
                </div>
                <span className={`${styles.countdown} mono`}>
                  {countdownShort(nextRunAt(publication), now)}
                </span>
                <span
                  className={styles.statusChip}
                  style={{
                    background: `var(--s-${status.token}Bg)`,
                    color: `var(--s-${status.token})`,
                  }}
                >
                  <span className={styles.dot} />
                  {status.label}
                </span>
              </div>
            );
          })}
        </section>

        <section aria-labelledby="h-acc" className={`${styles.list} ${styles.narrow}`}>
          <div className={styles.listHead}>
            <h2 id="h-acc" className={styles.panelTitle}>
              Account collegati
            </h2>
            <Link to="/impostazioni" className={styles.link}>
              Gestisci
            </Link>
          </div>
          {rows.map((row) => (
            <div key={row.platform} className={styles.listRow}>
              <PlatformIcon platform={row.platform} size={28} />
              <div className={styles.listText}>
                <span className={styles.strong}>{PLATFORM_LABELS[row.platform]}</span>
                <span className={styles.muted}>
                  {row.account?.displayName ?? row.note ?? 'Da collegare'}
                </span>
              </div>
              <span className={styles.accountStatus} style={{ color: row.statusColor }}>
                {row.statusLabel}
              </span>
            </div>
          ))}
        </section>
      </div>

      <div className={styles.row}>
        <section aria-labelledby="h-met" className={`${styles.metrics} ${styles.wide}`}>
          <div className={styles.metricsHead}>
            <h2 id="h-met" className={styles.panelTitle}>
              Ultimi 7 giorni
            </h2>
            <Link to="/analytics" className={styles.link}>
              Analytics
            </Link>
          </div>
          <div className={styles.metricGrid}>
            {weekMetricCards(summary.data).map((card) => (
              <div key={card.platform} className={styles.metricCard}>
                <div className={styles.metricHead}>
                  <PlatformIcon platform={card.platform} size={22} />
                  <span className={styles.metricWhat}>{card.what}</span>
                </div>
                <div className={styles.metricValueRow}>
                  <span className={styles.metricValue}>{card.value}</span>
                  {card.delta && (
                    <span
                      className={`${styles.metricDelta} mono`}
                      style={{ color: card.delta.positive ? 'var(--s-pub)' : 'var(--s-err)' }}
                    >
                      {card.delta.text}
                    </span>
                  )}
                </div>
                <span className={styles.metricSub}>{card.sub}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="h-ideas" className={`${styles.list} ${styles.narrow}`}>
          <div className={styles.listHead}>
            <h2 id="h-ideas" className={styles.panelTitle}>
              Idee in coda · {allIdeas.length}
            </h2>
            <Link to="/idee" className={styles.smallButton}>
              + Nuova idea
            </Link>
          </div>
          {allIdeas.length === 0 && <p className={styles.empty}>Nessuna idea nuova.</p>}
          {allIdeas.slice(0, IDEAS_LIMIT).map((idea) => (
            <div key={idea.id} className={styles.ideaRow}>
              <span className={styles.ideaText}>{idea.text}</span>
              {idea.tags[0] && <span className={styles.tag}>{idea.tags[0].name}</span>}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

/** Fondo del giorno: un velo del colore della prima piattaforma che esce quel giorno. */
function dayStyle(platforms: readonly Platform[]): CSSProperties | undefined {
  const first = platforms[0];
  if (!first) return undefined;
  return { '--dayTint': `var(--${PLATFORM_CODES[first]}Soft)` } as CSSProperties;
}
