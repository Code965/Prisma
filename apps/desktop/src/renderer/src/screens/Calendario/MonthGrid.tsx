import { STATUS_DISPLAY, type Idea } from '@prisma-app/shared';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { monthCells, type PlacedPublication } from '../../services/calendar';
import { zonedParts, type DayKey } from '../../services/zoned-time';
import styles from './Calendario.module.css';

const MONTH_HEAD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

interface MonthGridProps {
  anchor: DayKey;
  placed: PlacedPublication[];
  /** Idee del piano editoriale con il loro giorno proposto. */
  ideas: Map<DayKey, Idea[]>;
  now: Date;
  onOpenDay: (day: DayKey) => void;
}

/** Vista mese (V3Calendario): fino a tre uscite per giorno, clic per aprire la settimana. */
export function MonthGrid({ anchor, placed, ideas, now, onOpenDay }: MonthGridProps) {
  const today = zonedParts(now).day;
  return (
    <div className={styles.month}>
      <div className={styles.monthHead}>
        {MONTH_HEAD.map((name) => (
          <div key={name} className={styles.monthHeadCell}>
            {name}
          </div>
        ))}
      </div>
      <div className={styles.monthBody}>
        {monthCells(anchor, placed).map((cell) => (
          <button
            key={cell.day}
            type="button"
            className={styles.monthCell}
            data-out={!cell.inMonth || undefined}
            onClick={() => onOpenDay(cell.day)}
            aria-label={`Apri la settimana del ${cell.number}`}
          >
            <span className={`${styles.monthNumber} ${cell.day === today ? styles.dayToday : ''}`}>
              {cell.number}
            </span>
            {cell.pills.map(({ publication, time }) => {
              const status = STATUS_DISPLAY[publication.status];
              return (
                <span
                  key={publication.id}
                  className={styles.monthPill}
                  style={{ background: `var(--s-${status.token}Bg)` }}
                >
                  <PlatformIcon platform={publication.platform} size={16} />
                  <span className={`${styles.postTime} mono`}>{time}</span>
                  <span
                    className={styles.monthPillStatus}
                    style={{ color: `var(--s-${status.token})` }}
                  >
                    {status.short}
                  </span>
                </span>
              );
            })}
            {cell.more > 0 && <span className={styles.monthMore}>+{cell.more} altri</span>}
            {ideas.get(cell.day) && (
              <span
                className={styles.monthIdeas}
                title={ideas
                  .get(cell.day)!
                  .map((idea) => idea.text.split('\n')[0])
                  .join('\n')}
              >
                {ideas.get(cell.day)!.length === 1
                  ? '1 idea del piano'
                  : `${ideas.get(cell.day)!.length} idee del piano`}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
