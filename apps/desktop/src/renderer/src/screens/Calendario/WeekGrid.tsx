import { STATUS_DISPLAY, type Platform, type SlotMap } from '@prisma-app/shared';
import { useState } from 'react';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import {
  isMovable,
  isPastSlot,
  recommendedPlatforms,
  weekColumns,
  type PlacedPublication,
} from '../../services/calendar';
import { zonedParts, type DayKey } from '../../services/zoned-time';
import styles from './Calendario.module.css';
import { readDrag, startDrag, type DragItem } from './drag';

interface WeekGridProps {
  weekStart: DayKey;
  hours: number[];
  placed: PlacedPublication[];
  visible: ReadonlySet<Platform>;
  /** Slot consigliati (dai dati o predefiniti). */
  slots: SlotMap;
  now: Date;
  selectedContentId: number | null;
  onSelect: (contentId: number) => void;
  onDrop: (item: DragItem, day: DayKey, hour: number) => void;
}

/** Vista settimana (V3Calendario): righe orarie, slot consigliati, ora corrente, trascinamento. */
export function WeekGrid(props: WeekGridProps) {
  const { weekStart, hours, placed, visible, slots, now, selectedContentId, onSelect, onDrop } =
    props;
  const columns = weekColumns(weekStart);
  const today = zonedParts(now);
  const [dragging, setDragging] = useState<number | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null);

  return (
    <div className={styles.week}>
      <div className={styles.weekHead}>
        <div />
        {columns.map((column) => {
          const isToday = column.day === today.day;
          return (
            <div key={column.day} className={styles.dayHead}>
              <span className={styles.dayName}>{column.name}</span>
              <span className={`${styles.dayNumber} ${isToday ? styles.dayToday : ''}`}>
                {column.number}
              </span>
            </div>
          );
        })}
      </div>

      {hours.map((hour) => (
        <div key={hour} className={styles.hourRow}>
          <div className={`${styles.hourLabel} mono`}>{String(hour).padStart(2, '0')}:00</div>
          {columns.map((column, weekday) => {
            const cellKey = `${column.day}:${hour}`;
            const past = isPastSlot(column.day, hour, now);
            const posts = placed.filter((p) => p.day === column.day && p.hour === hour);
            const recommended = recommendedPlatforms(weekday, hour, visible, slots);
            const isNow = column.day === today.day && hour === today.hour;
            return (
              <div
                key={cellKey}
                className={styles.cell}
                data-past={past || undefined}
                data-rec={recommended.length > 0 || undefined}
                data-over={overCell === cellKey || undefined}
                onDragOver={(event) => {
                  if (past) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOverCell(cellKey);
                }}
                onDragLeave={() => setOverCell((current) => (current === cellKey ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setOverCell(null);
                  setDragging(null);
                  const item = readDrag(event);
                  if (item && !past) onDrop(item, column.day, hour);
                }}
              >
                {isNow && (
                  <div
                    aria-hidden
                    className={styles.nowLine}
                    style={{ top: `${(today.minute / 60) * 100}%` }}
                  />
                )}
                {recommended.length > 0 && posts.length === 0 && (
                  <div className={styles.rec}>
                    <span className={`${styles.recText} mono`}>consigliato</span>
                    {recommended.map((platform) => (
                      <PlatformIcon key={platform} platform={platform} size={16} />
                    ))}
                  </div>
                )}
                {posts.map(({ publication, time }) => {
                  const status = STATUS_DISPLAY[publication.status];
                  const movable = isMovable(publication);
                  const selected = publication.contentId === selectedContentId;
                  return (
                    <button
                      key={publication.id}
                      type="button"
                      draggable={movable}
                      aria-pressed={selected}
                      title={movable ? 'Trascina per spostare' : status.label}
                      className={styles.post}
                      data-selected={selected || undefined}
                      data-dragging={dragging === publication.id || undefined}
                      data-movable={movable || undefined}
                      style={{ background: `var(--s-${status.token}Bg)` }}
                      onClick={() => onSelect(publication.contentId)}
                      onDragStart={(event) => {
                        startDrag(event, { kind: 'publication', id: publication.id });
                        setDragging(publication.id);
                        onSelect(publication.contentId);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <span className={styles.postTop}>
                        <span className={`${styles.postTime} mono`}>{time}</span>
                        <PlatformIcon platform={publication.platform} size={16} />
                      </span>
                      <span className={styles.postTitle}>{publication.contentTitle}</span>
                      <span
                        className={styles.postStatus}
                        style={{ color: `var(--s-${status.token})` }}
                      >
                        {status.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
