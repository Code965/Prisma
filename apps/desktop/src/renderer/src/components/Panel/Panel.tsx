import type { ReactNode } from 'react';
import styles from './Panel.module.css';

interface PanelProps {
  /** Etichetta accessibile della sezione. */
  label?: string;
  children: ReactNode;
}

/** Riquadro bianco con bordo e angoli da 12 px usato in tutte le schermate del mockup. */
export function Panel({ label, children }: PanelProps) {
  return (
    <section aria-label={label} className={styles.panel}>
      {children}
    </section>
  );
}
