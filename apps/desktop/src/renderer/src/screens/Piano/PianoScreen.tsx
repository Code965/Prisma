import {
  PLATFORMS,
  PLATFORM_LABELS,
  type Platform,
  type PlanItemProgress,
} from '@prisma-app/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Icon } from '../../components/icons/Icon';
import { Page } from '../../components/Page/Page';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useTags } from '../../hooks/useIdeas';
import { useNow } from '../../hooks/useNow';
import { useCommentPlan, useGeneratePlan, usePlan, usePlanIdeas } from '../../hooks/usePlan';
import { errorMessage } from '../../services/api/client';
import {
  canGoForward,
  currentMonth,
  dayGroups,
  elapsedLabel,
  frequencyRows,
  monthTitle,
  pendingItemIds,
  pillarRows,
  planSubtitle,
  reviewTiles,
  shiftMonth,
  type PlanItemRow,
} from '../../services/plan';
import styles from './Piano.module.css';

const PROGRESS_TOKEN: Record<PlanItemProgress, string> = {
  da_creare: 'draft',
  idea: 'review',
  bozza: 'draft',
  programmato: 'sched',
  pubblicato: 'pub',
};

/**
 * Piano editoriale mensile (fase 8e): pilastri, frequenze, idee per giorno e revisione. Il piano
 * crea solo idee: le bozze si scrivono e si approvano come sempre.
 */
export function PianoScreen() {
  const now = useNow(60_000);
  const [month, setMonth] = useState(() => currentMonth(now));
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const state = usePlan(month);
  const tags = useTags();
  const generate = useGeneratePlan(month);
  const ideas = usePlanIdeas(month);
  const comment = useCommentPlan(month);
  const data = state.data;
  const plan = data?.plan ?? null;
  const pending = pendingItemIds(plan, data?.review ?? null);
  const groups = data ? dayGroups(data, now) : [];

  function runGenerate() {
    if (
      plan &&
      !window.confirm(
        'Rigenerare il piano? Le idee già create restano; le altre proposte vengono sostituite.',
      )
    ) {
      return;
    }
    generate.mutate(platforms);
  }

  const toggle = (p: Platform) =>
    setPlatforms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));

  const error = generate.error ?? ideas.error ?? comment.error ?? state.error;

  return (
    <Page
      title="Piano editoriale"
      subtitle={planSubtitle(data)}
      actions={
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Mese precedente"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            ‹
          </button>
          <span className={styles.monthName}>{monthTitle(month)}</span>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Mese successivo"
            disabled={!canGoForward(month, now)}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            ›
          </button>
        </div>
      }
    >
      {data && !data.blocked && (
        <section className={styles.panel} aria-labelledby="h-genera">
          <div className={styles.panelHead}>
            <h2 id="h-genera" className={styles.sectionTitle}>
              {plan ? 'Rigenera il piano' : 'Genera il piano del mese'}
            </h2>
            <span className={styles.meta}>
              Trend, concorrenti, i tuoi post migliori e gli orari consigliati
            </span>
          </div>
          <div className={styles.chips}>
            <span className={styles.meta}>Piattaforme:</span>
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.chip}
                aria-pressed={platforms.includes(p)}
                onClick={() => toggle(p)}
              >
                <PlatformIcon platform={p} size={18} />
                {PLATFORM_LABELS[p]}
              </button>
            ))}
            <span className={styles.meta}>
              {platforms.length === 0 ? 'nessuna scelta = quelle collegate' : ''}
            </span>
            <Button
              className={styles.push}
              icon={<Icon name="sparkle" size={16} />}
              disabled={generate.isPending}
              onClick={runGenerate}
            >
              {generate.isPending ? 'Preparo il piano…' : plan ? 'Rigenera' : 'Genera il piano'}
            </Button>
          </div>
        </section>
      )}

      {error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(error)}
        </p>
      ) : null}

      {data && !plan && (
        <section className={styles.empty} aria-label="Nessun piano">
          <p>
            {data.blocked ??
              (generate.isPending
                ? 'L’AI legge trend, concorrenti e i tuoi post e prepara il mese…'
                : 'Nessun piano per questo mese.')}
          </p>
          {data.blocked?.startsWith('AI') && <Link to="/impostazioni">Apri le Impostazioni</Link>}
          {data.booked.length > 0 && (
            <p className={styles.meta}>{data.booked.length} uscite già in calendario nel mese.</p>
          )}
        </section>
      )}

      {plan && (
        <>
          <section className={styles.panel} aria-labelledby="h-strategia">
            <div className={styles.panelHead}>
              <h2 id="h-strategia" className={styles.sectionTitle}>
                Strategia del mese
              </h2>
              <span className={`${styles.meta} mono`}>
                {plan.model} · {new Date(plan.createdAt).toLocaleDateString('it-IT')}
              </span>
            </div>
            <p className={styles.summary}>{plan.summary}</p>
          </section>

          <div className={styles.columns}>
            <section className={styles.panel} aria-labelledby="h-pilastri">
              <h2 id="h-pilastri" className={styles.sectionTitle}>
                Pilastri
              </h2>
              <ul className={styles.list}>
                {pillarRows(plan, tags.data ?? []).map((p) => (
                  <li key={p.name} className={styles.pillar}>
                    <div className={styles.rowHead}>
                      <strong>{p.name}</strong>
                      {p.tagName && <span className={styles.tag}>#{p.tagName}</span>}
                      <span className={`${styles.meta} ${styles.push}`}>{p.ideas} idee</span>
                    </div>
                    <p className={styles.text}>{p.description}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.panel} aria-labelledby="h-frequenze">
              <h2 id="h-frequenze" className={styles.sectionTitle}>
                Frequenza, formati e orari
              </h2>
              <ul className={styles.list}>
                {frequencyRows(plan).map((f) => (
                  <li key={f.platform} className={styles.frequency}>
                    <div className={styles.rowHead}>
                      <PlatformIcon platform={f.platform} size={20} />
                      <strong>{PLATFORM_LABELS[f.platform]}</strong>
                      <span>{f.perWeek}</span>
                      <span className={`${styles.meta} ${styles.push}`}>{f.ideas} idee</span>
                    </div>
                    <p className={styles.text}>
                      {f.formats} · <span className="mono">{f.slots}</span>
                    </p>
                    <p className={styles.meta}>{f.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {data?.review && (
            <section className={styles.panel} aria-labelledby="h-revisione">
              <div className={styles.panelHead}>
                <h2 id="h-revisione" className={styles.sectionTitle}>
                  Revisione: piano e fatto
                </h2>
                <span className={styles.meta}>{elapsedLabel(data.review)}</span>
                <Button
                  variant="secondary"
                  size={32}
                  className={styles.push}
                  icon={<Icon name="sparkle" size={14} />}
                  disabled={comment.isPending}
                  onClick={() => comment.mutate()}
                >
                  {comment.isPending ? 'Scrivo…' : 'Commento dell’AI'}
                </Button>
              </div>
              <div className={styles.progressBar} aria-hidden>
                <span style={{ width: `${Math.round(data.review.elapsed * 100)}%` }} />
              </div>
              <div className={styles.tiles}>
                {reviewTiles(data.review).map((t) => (
                  <div key={t.label} className={styles.tile}>
                    <span className={`${styles.tileValue} mono`}>{t.value}</span>
                    <span className={styles.meta}>{t.label}</span>
                  </div>
                ))}
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Piattaforma</th>
                    <th>Nel piano</th>
                    <th>Obiettivo</th>
                    <th>Pubblicate</th>
                    <th>Programmate</th>
                    <th>Interazioni mediane</th>
                  </tr>
                </thead>
                <tbody>
                  {data.review.platforms.map((p) => (
                    <tr key={p.platform}>
                      <td>
                        <span className={styles.rowHead}>
                          <PlatformIcon platform={p.platform} size={18} />
                          {PLATFORM_LABELS[p.platform]}
                        </span>
                      </td>
                      <td className="mono">{p.planned}</td>
                      <td className="mono">{p.target}</td>
                      <td className="mono">{p.published}</td>
                      <td className="mono">{p.scheduled}</td>
                      <td className="mono">
                        {p.medianInteractions?.toLocaleString('it-IT') ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.reviewComment && (
                <p className={styles.comment}>
                  {plan.reviewComment.text}
                  <span className={`${styles.meta} mono`}> · {plan.reviewComment.model}</span>
                </p>
              )}
            </section>
          )}

          <section className={styles.panel} aria-labelledby="h-idee">
            <div className={styles.panelHead}>
              <h2 id="h-idee" className={styles.sectionTitle}>
                Idee del mese
              </h2>
              <span className={styles.meta}>
                Diventano idee da scrivere e approvare: nulla si pubblica da solo
              </span>
              {pending.length > 0 && (
                <div className={styles.push}>
                  <Button
                    variant="secondary"
                    size={32}
                    disabled={ideas.isPending}
                    onClick={() => ideas.mutate({ itemIds: pending, withDay: false })}
                  >
                    Crea tutte le idee
                  </Button>
                  <Button
                    size={32}
                    disabled={ideas.isPending}
                    onClick={() => ideas.mutate({ itemIds: pending, withDay: true })}
                  >
                    Metti tutto nel calendario ({pending.length})
                  </Button>
                </div>
              )}
            </div>
            <ol className={styles.days}>
              {groups.map((g) => (
                <li key={g.day} className={styles.day} data-past={g.past || undefined}>
                  <span className={`${styles.dayLabel} mono`}>{g.label}</span>
                  <div className={styles.dayItems}>
                    {g.booked.map((b) => (
                      <div key={`${b.platform}-${b.title}`} className={styles.booked}>
                        <PlatformIcon platform={b.platform} size={18} />
                        <span>Già in calendario: {b.title}</span>
                      </div>
                    ))}
                    {g.rows.map((row) => (
                      <ItemRow
                        key={row.item.id}
                        row={row}
                        busy={ideas.isPending}
                        onCreate={(withDay) => ideas.mutate({ itemIds: [row.item.id], withDay })}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </Page>
  );
}

function ItemRow({
  row,
  busy,
  onCreate,
}: {
  row: PlanItemRow;
  busy: boolean;
  onCreate: (withDay: boolean) => void;
}) {
  const { item, review } = row;
  const token = review?.late
    ? 'err'
    : PROGRESS_TOKEN[review?.progress ?? (row.pending ? 'da_creare' : 'idea')];
  return (
    <article className={styles.item}>
      <div className={styles.rowHead}>
        <PlatformIcon platform={item.platform} size={20} />
        <span className={styles.format}>{row.formatLabel}</span>
        {row.time && <span className={`${styles.meta} mono`}>{row.time}</span>}
        <span className={styles.pillarChip}>{item.pillar}</span>
        <span
          className={styles.status}
          style={{ color: `var(--s-${token})`, background: `var(--s-${token}Bg)` }}
        >
          {row.progressLabel}
        </span>
      </div>
      <p className={styles.text}>{item.text}</p>
      <div className={styles.rowHead}>
        <span className={styles.meta}>
          {row.sourceLabel}
          {item.reference && (
            <>
              {': '}
              {item.reference.url ? (
                <a href={item.reference.url} target="_blank" rel="noreferrer">
                  {item.reference.label}
                </a>
              ) : (
                item.reference.label
              )}
            </>
          )}
        </span>
        <div className={styles.push}>
          {row.pending ? (
            <>
              <button
                type="button"
                className={styles.action}
                disabled={busy}
                onClick={() => onCreate(false)}
              >
                Crea l’idea
              </button>
              <button
                type="button"
                className={styles.action}
                disabled={busy}
                onClick={() => onCreate(true)}
              >
                Metti nel calendario
              </button>
            </>
          ) : review?.url ? (
            <a href={review.url} target="_blank" rel="noreferrer" className={styles.action}>
              Apri il post
              {review.interactions !== null ? ` · ${review.interactions} interazioni` : ''}
            </a>
          ) : (
            <Link to="/idee" className={styles.action}>
              Apri le idee
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
