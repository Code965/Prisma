import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import {
  useBrollFolder,
  useSetBrollDir,
  useSetStockKey,
  useStockStatus,
} from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import { PIXABAY_KEY_PAGE, brollFolderLabel } from '../../services/layers';
import styles from './Impostazioni.module.css';

/**
 * B-roll (6d): la cartella con i tuoi spezzoni e immagini e la chiave gratuita di Pixabay per
 * cercare quelli che mancano. La chiave resta cifrata sul server e non torna mai qui.
 */
export function BrollSettings() {
  const folder = useBrollFolder();
  const setDir = useSetBrollDir();
  const stock = useStockStatus();
  const setKey = useSetStockKey();
  const [apiKey, setApiKey] = useState('');
  const configured = stock.data?.configured ?? false;

  return (
    <>
      <div className={styles.accountRow}>
        <div className={styles.accountText}>
          <span className={styles.accountName}>
            Cartella del B-roll{' '}
            <span
              className={styles.accountHandle}
              style={{ color: folder.data?.dir ? 'var(--s-pub)' : 'var(--muted)' }}
            >
              {brollFolderLabel(folder.data ?? null)}
            </span>
          </span>
          <span className={`${styles.accountStatus} ${styles.toolPath} mono`}>
            {folder.data?.dir ??
              'Facoltativa: i tuoi spezzoni e immagini, con nomi che dicono cosa mostrano (es. tastiera-notte.mp4)'}
          </span>
        </div>
        <Button
          variant="secondary"
          size={32}
          disabled={setDir.isPending}
          onClick={() => setDir.mutate('pick')}
        >
          Scegli…
        </Button>
        {folder.data?.dir && (
          <button
            type="button"
            className={styles.inlineLink}
            disabled={setDir.isPending}
            onClick={() => setDir.mutate('clear')}
          >
            Togli
          </button>
        )}
      </div>

      <div className={styles.accountRow}>
        <div className={styles.accountText}>
          <span className={styles.accountName}>
            Pixabay{' '}
            <span
              className={styles.accountHandle}
              style={{ color: configured ? 'var(--s-pub)' : 'var(--muted)' }}
            >
              {configured ? 'Chiave salvata' : 'Nessuna chiave'}
            </span>
          </span>
          <span className={styles.accountStatus}>
            Video e foto gratuiti per il B-roll che non trovi nella tua cartella. La chiave è
            gratuita con un account Pixabay e resta cifrata sul computer.
          </span>
          <div className={styles.keyRow}>
            <input
              type="password"
              aria-label="Chiave API di Pixabay"
              className={`${styles.input} mono`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                configured
                  ? 'Reinseriscila per cambiarla'
                  : 'La trovi nella pagina della documentazione'
              }
              autoComplete="off"
            />
            <Button
              size={32}
              disabled={apiKey.trim().length < 10 || setKey.isPending}
              onClick={() => setKey.mutate(apiKey.trim(), { onSuccess: () => setApiKey('') })}
            >
              {setKey.isPending ? 'Verifico…' : 'Salva e verifica'}
            </Button>
          </div>
        </div>
        <Button
          variant="secondary"
          size={32}
          onClick={() => void window.prisma?.openExternal(PIXABAY_KEY_PAGE)}
        >
          Apri Pixabay
        </Button>
        {configured && (
          <button
            type="button"
            className={styles.inlineLink}
            disabled={setKey.isPending}
            onClick={() => setKey.mutate(null)}
          >
            Togli
          </button>
        )}
      </div>
      {folder.error || setDir.error || stock.error || setKey.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(folder.error ?? setDir.error ?? stock.error ?? setKey.error)}
        </p>
      ) : null}
    </>
  );
}
