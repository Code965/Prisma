import {
  PLATFORMS,
  PLATFORM_LABELS,
  STATUS_DISPLAY,
  type Platform,
  slotMap,
} from '@prisma-app/shared';
import { useState } from 'react';
import { useRecommendedSlots } from '../../hooks/useAnalytics';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons/Icon';
import { Panel } from '../../components/Panel/Panel';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import {
  useContents,
  usePublications,
  useReschedule,
  useRescheduleMany,
  useSchedule,
} from '../../hooks/useCalendar';
import { useNow } from '../../hooks/useNow';
import { errorMessage } from '../../services/api/client';
import {
  LEGEND,
  hourRange,
  placePublications,
  planningRows,
  rangeLabel,
  recommendedMoves,
  slotsSourceNote,
  slotInstant,
  unscheduledItems,
  type CalendarView,
} from '../../services/calendar';
import {
  addDays,
  addMonths,
  startOfWeek,
  weekDays,
  zonedParts,
  type DayKey,
} from '../../services/zoned-time';
import styles from './Calendario.module.css';
import type { DragItem } from './drag';
import { MonthGrid } from './MonthGrid';
import { PlanningPanel } from './PlanningPanel';
import { UnscheduledList } from './UnscheduledList';
import { WeekGrid } from './WeekGrid';

/** Calendario e pianificazione (V3Calendario). */
export function CalendarioScreen() {
  const now = useNow(30_000);
  const publications = usePublications();
  const contents = useContents();
  const schedule = useSchedule();
  const reschedule = useReschedule();
  const rescheduleMany = useRescheduleMany();

  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState<DayKey>(() => zonedParts(new Date()).day);
  const [visible, setVisible] = useState<ReadonlySet<Platform>>(() => new Set(PLATFORMS));
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const weekStart = startOfWeek(anchor);
  const placed = placePublications(publications.data ?? [], visible);
  const hours = hourRange(placed, weekDays(weekStart));
  const unscheduled = unscheduledItems(contents.data ?? []);
  const selected =
    contents.data?.find((c) => c.id === selectedId) ??
    contents.data?.find((c) => c.id === placed[0]?.publication.contentId) ??
    null;
  const recommended = useRecommendedSlots();
  const slots = slotMap(recommended.data);
  const rows = selected ? planningRows(selected, publications.data ?? [], slots) : [];
  const moves = recommendedMoves(rows, now, slots);
  const mutationError = schedule.error ?? reschedule.error ?? rescheduleMany.error;

  function move(step: number) {
    setAnchor((day) => (view === 'week' ? addDays(day, 7 * step) : addMonths(day, step)));
  }

  function togglePlatform(platform: Platform) {
    setVisible((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  function handleDrop(item: DragItem, day: DayKey, hour: number) {
    const scheduledAt = slotInstant(day, hour);
    if (item.kind === 'publication') {
      reschedule.mutate({ id: item.id, scheduledAt });
      return;
    }
    const target = unscheduled.find((u) => u.variant.id === item.id && u.draggable);
    if (target) {
      schedule.mutate({
        variantId: target.variant.id,
        platform: target.variant.platform,
        scheduledAt,
      });
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Calendario</h1>
          <div className={styles.nav}>
            <button
              type="button"
              aria-label="Periodo precedente"
              className={styles.navArrow}
              onClick={() => move(-1)}
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <button
              type="button"
              className={styles.navToday}
              onClick={() => setAnchor(zonedParts(new Date()).day)}
            >
              Oggi
            </button>
            <button
              type="button"
              aria-label="Periodo successivo"
              className={styles.navArrow}
              onClick={() => move(1)}
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
          <span className={styles.range}>{rangeLabel(view, anchor, weekStart)}</span>
        </div>
        <div className={styles.headerRight}>
          <div role="group" aria-label="Vista" className={styles.segmented}>
            {(['month', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={styles.segment}
                data-on={view === v || undefined}
                onClick={() => setView(v)}
              >
                {v === 'month' ? 'Mese' : 'Settimana'}
              </button>
            ))}
          </div>
          <Link to="/idee" className={styles.primaryLink}>
            <span aria-hidden className={styles.plus}>
              +
            </span>{' '}
            Nuovo contenuto
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div role="group" aria-label="Filtra per piattaforma" className={styles.filters}>
          {PLATFORMS.map((platform) => {
            const on = visible.has(platform);
            return (
              <button
                key={platform}
                type="button"
                aria-pressed={on}
                className={styles.filter}
                data-on={on || undefined}
                onClick={() => togglePlatform(platform)}
              >
                <PlatformIcon platform={platform} size={22} />
                {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>
        <div aria-label="Legenda stati" className={styles.legend}>
          {LEGEND.map((status) => {
            const display = STATUS_DISPLAY[status];
            return (
              <span
                key={status}
                className={styles.statusChip}
                style={{
                  background: `var(--s-${display.token}Bg)`,
                  color: `var(--s-${display.token})`,
                }}
              >
                <span className={styles.dot} />
                {display.label}
              </span>
            );
          })}
        </div>
      </div>

      {mutationError ? (
        <p role="alert" className={styles.error}>
          {errorMessage(mutationError)}
        </p>
      ) : null}
      {publications.error ? (
        <Panel label="Errore">
          <p role="alert" className={styles.error}>
            {errorMessage(publications.error)}
          </p>
        </Panel>
      ) : null}

      <div className={styles.layout}>
        <section aria-label={rangeLabel(view, anchor, weekStart)} className={styles.calendar}>
          <div
            role="region"
            aria-label="Griglia del calendario"
            tabIndex={0}
            className={styles.scroller}
          >
            {view === 'week' ? (
              <WeekGrid
                weekStart={weekStart}
                hours={hours}
                placed={placed}
                visible={visible}
                slots={slots}
                now={now}
                selectedContentId={selected?.id ?? null}
                onSelect={setSelectedId}
                onDrop={handleDrop}
              />
            ) : (
              <MonthGrid
                anchor={anchor}
                placed={placed}
                now={now}
                onOpenDay={(day) => {
                  setAnchor(day);
                  setView('week');
                }}
              />
            )}
          </div>
          <div className={styles.calendarFooter}>
            Trascina un post per spostarlo, o una bozza approvata da «Da pianificare» per
            programmarla. {slotsSourceNote(recommended.data)}
          </div>
        </section>

        <aside className={styles.side}>
          <PlanningPanel
            content={selected}
            rows={rows}
            movesAvailable={moves.length}
            applying={rescheduleMany.isPending}
            onApplyRecommended={() => rescheduleMany.mutate(moves)}
          />
          <UnscheduledList items={unscheduled} onSelect={setSelectedId} />
        </aside>
      </div>
    </main>
  );
}
