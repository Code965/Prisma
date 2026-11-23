import { Button } from '../../components/Button/Button';
import { useUpdates } from '../../hooks/useUpdates';
import { canCheckUpdates, updateStatusLabel } from '../../services/updates';
import styles from './Impostazioni.module.css';

/** Versione installata e «Verifica aggiornamenti» (le release arrivano da GitHub). */
export function UpdatesSection() {
  const { state, check } = useUpdates();
  if (!state) return null;

  return (
    <section aria-labelledby="h-updates" className={`${styles.section} ${styles.accounts}`}>
      <div className={styles.sectionHead}>
        <h2 id="h-updates" className={styles.sectionTitle}>
          Versione
        </h2>
        <span className={styles.sectionHint}>
          Gli aggiornamenti arrivano dalle release di GitHub
        </span>
      </div>
      <div className={styles.accountRow}>
        <div className={styles.accountText}>
          <span className={styles.accountName}>
            Prisma <span className="mono">v{state.currentVersion}</span>
          </span>
          <span className={styles.accountStatus}>{updateStatusLabel(state)}</span>
        </div>
        <Button
          variant="secondary"
          size={32}
          disabled={!canCheckUpdates(state)}
          onClick={() => void check()}
        >
          Verifica aggiornamenti
        </Button>
      </div>
    </section>
  );
}
