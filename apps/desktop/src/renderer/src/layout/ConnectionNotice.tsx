import { Link, useLocation } from 'react-router-dom';
import { useBrand } from '../hooks/brand';
import { errorMessage } from '../services/api/client';
import styles from './ConnectionNotice.module.css';

/** Avviso in cima alla schermata quando i dati (server interno o remoto) non rispondono. */
export function ConnectionNotice() {
  const { error } = useBrand();
  const { pathname } = useLocation();
  if (!error) return null;

  return (
    <div role="alert" className={styles.notice}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.text}>Dati non raggiungibili: {errorMessage(error)}</span>
      {pathname !== '/impostazioni' && (
        <Link to="/impostazioni" className={styles.link}>
          Apri le impostazioni
        </Link>
      )}
    </div>
  );
}
