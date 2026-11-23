import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackgroundSettings } from '../../../../main/ipc-contract';
import { errorMessage } from '../../services/api/client';
import styles from './Impostazioni.module.css';

const KEY = ['background'] as const;

/**
 * Prisma in background: chiudendo la finestra resta nell'area di notifica e pubblica le uscite
 * programmate; avvio con Windows facoltativo. Solo nell'app desktop con i dati sul computer.
 */
export function BackgroundSection() {
  const bridge = window.prisma?.background;
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => bridge!.get(),
    enabled: Boolean(bridge),
  });
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<BackgroundSettings, 'keepRunning' | 'openAtLogin'>>) =>
      bridge!.set(patch),
    onSuccess: (view) => client.setQueryData(KEY, view),
  });
  const view = settings.data;
  if (!bridge || !view) return null;

  return (
    <section aria-labelledby="h-background" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="h-background" className={styles.sectionTitle}>
          In background
        </h2>
        <span className={styles.sectionHint}>
          {view.available
            ? 'Lo scheduler pubblica solo mentre Prisma è attiva: lasciala nell’area di notifica'
            : 'Con un server remoto è lui a pubblicare: qui non serve'}
        </span>
      </div>
      {view.available && (
        <div className={styles.checks}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={view.keepRunning}
              disabled={update.isPending}
              onChange={(event) => update.mutate({ keepRunning: event.target.checked })}
            />
            <span>
              <span className={styles.brandName}>Resta attiva quando chiudi la finestra</span>
              <span className={styles.sectionHint}>
                Prisma va nell’area di notifica e continua a pubblicare. «Esci da Prisma» dal suo
                menu la chiude davvero.
              </span>
            </span>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={view.openAtLogin}
              disabled={update.isPending || !view.canOpenAtLogin}
              onChange={(event) => update.mutate({ openAtLogin: event.target.checked })}
            />
            <span>
              <span className={styles.brandName}>Avvia con Windows</span>
              <span className={styles.sectionHint}>
                {view.canOpenAtLogin
                  ? 'Parte nascosta all’accensione del PC, così le uscite non si perdono'
                  : 'Disponibile nell’app installata'}
              </span>
            </span>
          </label>
        </div>
      )}
      {update.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(update.error)}
        </p>
      ) : null}
    </section>
  );
}
