import { STATUS_DISPLAY, type PublicationStatus, type VariantStatus } from '@prisma-app/shared';
import styles from './StatusPill.module.css';

interface StatusPillProps {
  status: VariantStatus | PublicationStatus;
  /** Etichetta breve ("progr.") per gli spazi stretti come le celle del calendario. */
  short?: boolean;
}

/** Stato sempre con colore ed etichetta, mai solo colore (regola del mockup). */
export function StatusPill({ status, short = false }: StatusPillProps) {
  const display = STATUS_DISPLAY[status];
  return (
    <span
      className={styles.pill}
      style={{ background: `var(--s-${display.token}Bg)`, color: `var(--s-${display.token})` }}
      title={short ? display.label : undefined}
    >
      {short ? display.short : display.label}
    </span>
  );
}
