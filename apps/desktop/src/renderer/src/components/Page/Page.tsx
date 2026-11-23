import type { CSSProperties, ReactNode } from 'react';
import styles from './Page.module.css';

interface PageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Azioni a destra del titolo (pulsanti, filtri). */
  actions?: ReactNode;
  /** Alcune schermate del mockup limitano la larghezza (Idee: 1100 px). */
  maxWidth?: number;
  /** Spazio verticale tra i blocchi: 16 px di default, 14 nel video, 18 nei template. */
  gap?: number;
  /** Testo sopra il titolo (percorso), es. "Idee / Studio contenuto". */
  breadcrumb?: ReactNode;
  /** Elementi accanto al titolo (es. tag). */
  titleExtra?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Area principale di una schermata con intestazione, come nel `<main>` del mockup. */
export function Page({
  title,
  subtitle,
  actions,
  maxWidth,
  gap,
  breadcrumb,
  titleExtra,
  className,
  children,
}: PageProps) {
  const style: CSSProperties = { maxWidth, gap };
  return (
    <main className={`${styles.page} ${className ?? ''}`} style={style}>
      <header className={styles.header}>
        <div className={styles.heading}>
          {breadcrumb && (
            <nav aria-label="Percorso" className={styles.breadcrumb}>
              {breadcrumb}
            </nav>
          )}
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {titleExtra}
          </div>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </main>
  );
}
