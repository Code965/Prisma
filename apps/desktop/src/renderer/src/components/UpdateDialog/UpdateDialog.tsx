import { useEffect, useRef } from 'react';
import { useUpdates } from '../../hooks/useUpdates';
import { Button } from '../Button/Button';
import styles from './UpdateDialog.module.css';

/**
 * Finestra «Aggiornamento disponibile» (come in NaviFox): si apre a ogni avvio quando il main
 * ha scaricato una versione nuova che non è stata saltata, oppure dopo «Verifica aggiornamenti».
 */
export function UpdateDialog() {
  const { state, dismiss, skip, install } = useUpdates();
  const dialog = useRef<HTMLDialogElement>(null);
  const open = Boolean(state?.prompt);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  if (!state) return null;
  const ready = state.status === 'pronto';

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="update-title"
      // Esc equivale a «Più tardi».
      onCancel={(event) => {
        event.preventDefault();
        void dismiss();
      }}
    >
      {ready ? (
        <>
          <div className={styles.head}>
            <span className={styles.badge} aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
            </span>
            <div className={styles.headText}>
              <h2 id="update-title" className={styles.title}>
                Prisma {state.version} è pronto
              </h2>
              <div className={styles.versions}>
                <span className={`${styles.chip} mono`}>v{state.currentVersion}</span>
                <span aria-hidden className={styles.arrow}>
                  →
                </span>
                <span className={`${styles.chip} ${styles.chipNew} mono`}>v{state.version}</span>
              </div>
            </div>
          </div>
          <div className={styles.body}>
            <span className={`${styles.label} mono`}>Novità</span>
            <div className={styles.notes}>{state.notes ?? 'Nessuna nota per questa versione.'}</div>
            <p className={styles.hint}>
              Prisma si chiuderà, si aggiornerà e si riaprirà da solo. Le bozze sono sul server:
              salva prima le modifiche in corso nello Studio o negli editor.
            </p>
          </div>
          <div className={styles.foot}>
            <button type="button" className={styles.link} onClick={() => void skip()}>
              Salta questa versione
            </button>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => void dismiss()}>
                Più tardi
              </Button>
              <Button onClick={() => void install()} autoFocus>
                Aggiorna ora
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={styles.body}>
            <h2 id="update-title" className={styles.title}>
              {state.status === 'errore' ? 'Aggiornamenti non verificati' : 'Prisma è aggiornato'}
            </h2>
            <p className={styles.hint}>
              {state.status === 'errore'
                ? state.error
                : `Stai usando l’ultima versione (v${state.currentVersion}).`}
            </p>
          </div>
          <div className={styles.foot}>
            <span />
            <Button onClick={() => void dismiss()} autoFocus>
              Ok
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
