import { PLATFORM_LABELS, STATUS_DISPLAY, type Content } from '@prisma-app/shared';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import type { PlanningRow } from '../../services/calendar';
import styles from './Calendario.module.css';

interface PlanningPanelProps {
  content: Content | null;
  rows: PlanningRow[];
  movesAvailable: number;
  applying: boolean;
  onApplyRecommended: () => void;
}

/** "Pianificazione multipiattaforma" (V3Calendario): un contenuto, un'uscita per piattaforma. */
export function PlanningPanel({
  content,
  rows,
  movesAvailable,
  applying,
  onApplyRecommended,
}: PlanningPanelProps) {
  return (
    <section aria-labelledby="h-multi" className={styles.sideSection}>
      <div className={styles.sideHead}>
        <span className={`${styles.kicker} mono`}>PIANIFICAZIONE MULTIPIATTAFORMA</span>
        {content ? (
          <>
            <h2 id="h-multi" className={styles.groupTitle}>
              {content.title}
            </h2>
            <span className={styles.hint}>
              Un contenuto, {rows.length} {rows.length === 1 ? 'uscita' : 'uscite'} con orari
              diversi
            </span>
          </>
        ) : (
          <>
            <h2 id="h-multi" className={styles.groupTitle}>
              Nessun contenuto selezionato
            </h2>
            <span className={styles.hint}>
              Seleziona un post nel calendario o tra quelli da pianificare.
            </span>
          </>
        )}
      </div>

      {rows.length > 0 && (
        <div className={styles.groupRows}>
          {rows.map((row) => {
            const status = STATUS_DISPLAY[row.status];
            return (
              <div key={row.variant.id} className={styles.groupRow}>
                <PlatformIcon platform={row.variant.platform} size={28} />
                <div className={styles.groupText}>
                  <span className={styles.groupName}>{PLATFORM_LABELS[row.variant.platform]}</span>
                  <span className={`${styles.groupWhen} mono`}>{row.when}</span>
                  <span className={styles.groupRec}>{row.recommendation}</span>
                </div>
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
        </div>
      )}

      {content && (
        <div className={styles.sideActions}>
          <Button
            variant="secondary"
            className={styles.grow}
            disabled={movesAvailable === 0 || applying}
            onClick={onApplyRecommended}
            title={
              movesAvailable === 0
                ? 'Le uscite programmate sono già negli orari consigliati'
                : undefined
            }
          >
            {applying ? 'Sposto…' : 'Usa orari consigliati'}
          </Button>
          <Link to={`/studio/${content.id}`} className={`${styles.primaryLink} ${styles.grow}`}>
            Apri nello Studio
          </Link>
        </div>
      )}
    </section>
  );
}
