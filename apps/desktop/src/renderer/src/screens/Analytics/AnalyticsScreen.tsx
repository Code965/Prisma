import {
  ANALYTICS_METRICS,
  ANALYTICS_METRIC_LABELS,
  ANALYTICS_PERIODS,
  ANALYTICS_PERIOD_LABELS,
  type AnalyticsMetric,
  type AnalyticsPeriod,
} from '@prisma-app/shared';
import { useState } from 'react';
import { Page } from '../../components/Page/Page';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useAnalyticsReport } from '../../hooks/useAnalytics';
import { platformCard, topRows } from '../../services/analytics';
import { errorMessage } from '../../services/api/client';
import { InsightsPanel } from './InsightsPanel';
import { LinkedInMetricsPanel } from './LinkedInMetricsPanel';
import styles from './Analytics.module.css';

const PLATFORM_COLOR: Record<string, string> = {
  linkedin: 'var(--li)',
  instagram: 'var(--ig)',
  tiktok: 'var(--tt)',
  youtube: 'var(--yt)',
};

/** Analytics (V3Analytics): piccoli multipli per piattaforma, contenuti migliori, LinkedIn a mano. */
export function AnalyticsScreen() {
  const [metric, setMetric] = useState<AnalyticsMetric>('reach');
  const [period, setPeriod] = useState<AnalyticsPeriod>('8w');
  const report = useAnalyticsReport(period);
  const data = report.data;
  const metricLabel = ANALYTICS_METRIC_LABELS[metric];
  const periodLabel = ANALYTICS_PERIOD_LABELS[period].toLowerCase();

  return (
    <Page
      title="Analytics"
      actions={
        <div className={styles.controls}>
          <div role="group" aria-label="Metrica" className={styles.tabs}>
            {ANALYTICS_METRICS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={m === metric}
                className={styles.tab}
                onClick={() => setMetric(m)}
              >
                {m === 'followers' ? 'Follower' : ANALYTICS_METRIC_LABELS[m]}
              </button>
            ))}
          </div>
          <label htmlFor="period" className="sr-only">
            Periodo
          </label>
          <select
            id="period"
            className={styles.select}
            value={period}
            onChange={(event) => setPeriod(event.target.value as AnalyticsPeriod)}
          >
            {ANALYTICS_PERIODS.map((p) => (
              <option key={p} value={p}>
                {ANALYTICS_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {report.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(report.error)}
        </p>
      ) : null}

      <section aria-label={`${metricLabel} per piattaforma`} className={styles.grid}>
        {(data?.platforms ?? []).map((series) => {
          const card = platformCard(series, metric, data!);
          const color = PLATFORM_COLOR[card.platform] ?? 'var(--accent)';
          return (
            <article key={card.platform} className={styles.card}>
              <div className={styles.cardHead}>
                <PlatformIcon platform={card.platform} size={24} />
                <h2 className={styles.cardTitle}>{card.name}</h2>
                <span className={styles.cardMetric}>{metricLabel}</span>
              </div>
              <div className={styles.totalRow}>
                <span className={styles.total}>{card.total}</span>
                {card.delta && (
                  <span
                    className={`${styles.delta} mono`}
                    style={{ color: card.delta.positive ? 'var(--s-pub)' : 'var(--s-err)' }}
                  >
                    {card.delta.text}
                  </span>
                )}
              </div>
              <div role="img" aria-label={card.aria} className={styles.bars}>
                {card.bars.map((bar, i) => (
                  <div
                    key={i}
                    title={bar.tip}
                    className={styles.bar}
                    style={{
                      height: bar.height,
                      background: bar.empty ? 'var(--line)' : color,
                      opacity: bar.current ? 1 : 0.55,
                    }}
                  />
                ))}
              </div>
              <div className={`${styles.axis} mono`}>
                <span>{data!.buckets[0]?.label}</span>
                <span>{data!.buckets[data!.buckets.length - 1]?.label}</span>
              </div>
              {card.note && <p className={styles.note}>{card.note}</p>}
            </article>
          );
        })}
      </section>

      <div className={styles.lower}>
        <section aria-labelledby="h-top" className={styles.top}>
          <h2 id="h-top" className={styles.sectionTitle}>
            Contenuti migliori · {periodLabel}
          </h2>
          <div className={`${styles.topRow} ${styles.topHead} mono`}>
            <span>#</span>
            <span />
            <span>CONTENUTO</span>
            <span className={styles.num}>COPERTURA</span>
            <span className={styles.num}>INTERAZ.</span>
          </div>
          {topRows(data?.top ?? []).map((row) => (
            <div key={row.n} className={styles.topRow}>
              <span className={`${styles.rank} mono`}>{row.n}</span>
              <PlatformIcon platform={row.platform} size={24} />
              <div className={styles.topText}>
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noreferrer" className={styles.topTitle}>
                    {row.title}
                  </a>
                ) : (
                  <span className={styles.topTitle}>{row.title}</span>
                )}
                <span className={styles.topFormat}>{row.format}</span>
              </div>
              <span className={`${styles.num} mono`} title={row.reachTitle}>
                {row.reach}
              </span>
              <span className={`${styles.num} mono`}>{row.interactions}</span>
            </div>
          ))}
          {data && data.top.length === 0 && (
            <p className={styles.empty}>
              Ancora nessun contenuto con metriche in questo periodo: arrivano entro un giorno dalla
              pubblicazione (LinkedIn: inseriscile a mano).
            </p>
          )}
        </section>

        <section aria-labelledby="h-ai" className={styles.aside}>
          <InsightsPanel />
          <LinkedInMetricsPanel rows={data?.manual ?? []} />
        </section>
      </div>
    </Page>
  );
}
