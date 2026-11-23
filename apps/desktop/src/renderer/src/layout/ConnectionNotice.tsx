import { Link, useLocation } from 'react-router-dom';
import { useBrand } from '../hooks/brand';
import { errorMessage } from '../services/api/client';
import styles from './ConnectionNotice.module.css';

/** Avviso in cima alla schermata quando il server non risponde o rifiuta il token. */
export function ConnectionNotice() {
  const { error } = useBrand();
  const { pathname } = useLocation();
  if (!error) return null;

  return (
    <div role="alert" className={styles.notice}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.text}>Server non collegato: {errorMessage(error)}</span>
      {pathname !== '/impostazioni' && (
        <Link to="/impostazioni" className={styles.link}>
          Apri le impostazioni
        </Link>
      )}
    </div>
  );
}
