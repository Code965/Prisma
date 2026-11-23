import { STATUS_DISPLAY } from '@prisma-app/shared';
import { useNavigate } from 'react-router-dom';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import type { UnscheduledItem } from '../../services/calendar';
import styles from './Calendario.module.css';
import { startDrag } from './drag';

interface UnscheduledListProps {
  items: UnscheduledItem[];
  onSelect: (contentId: number) => void;
}

/**
 * "Da pianificare" (V3Calendario). Si trascinano solo le bozze approvate: le altre vanno
 * prima approvate nello Studio, dove il clic le porta.
 */
export function UnscheduledList({ items, onSelect }: UnscheduledListProps) {
  const navigate = useNavigate();
  return (
    <section aria-labelledby="h-da" className={styles.sideSection}>
      <div className={styles.unscheduledHead}>
        <h2 id="h-da" className={styles.sideTitle}>
          Da pianificare
        </h2>
        <span className={styles.hint}>trascina nel calendario</span>
      </div>
      {items.length === 0 && <p className={styles.hint}>Niente in attesa: tutto è pianificato.</p>}
      {items.map(({ variant, contentTitle, draggable }) => {
        const status = STATUS_DISPLAY[variant.status];
        return (
          <button
            key={variant.id}
            type="button"
            draggable={draggable}
            className={styles.unscheduled}
            data-draggable={draggable || undefined}
            title={
              draggable
                ? 'Trascina in uno slot del calendario'
                : 'Approvala nello Studio per pianificarla'
            }
            onClick={() =>
              draggable ? onSelect(variant.contentId) : navigate(`/studio/${variant.contentId}`)
            }
            onDragStart={(event) => {
              startDrag(event, { kind: 'variant', id: variant.id });
              onSelect(variant.contentId);
            }}
          >
            <span className={styles.unscheduledTop}>
              <PlatformIcon platform={variant.platform} size={18} />
              <span
                className={styles.unscheduledStatus}
                style={{ color: `var(--s-${status.token})` }}
              >
                {status.label}
              </span>
            </span>
            <span className={styles.unscheduledTitle}>{contentTitle}</span>
          </button>
        );
      })}
    </section>
  );
}
