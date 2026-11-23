import { useState } from 'react';
import type { ConnectionMode, ConnectionSettingsView } from '../../../../main/ipc-contract';
import { Button } from '../../components/Button/Button';
import {
  useConnectionSettings,
  useSaveConnection,
  useTestConnection,
} from '../../hooks/useConnection';
import { errorMessage } from '../../services/api/client';
import styles from './Impostazioni.module.css';

const TOKEN_SOURCE_LABEL = {
  salvato: 'Token salvato cifrato nell’archivio credenziali di Windows',
  'env-sviluppo': 'In sviluppo: token letto dal file .env del progetto',
  assente: 'Nessun token: incollalo qui sotto',
} as const;

const MODES: { mode: ConnectionMode; label: string; hint: string }[] = [
  {
    mode: 'locale',
    label: 'Su questo computer',
    hint: 'Consigliato: Prisma lavora da sola, i dati restano sul tuo PC',
  },
  {
    mode: 'remoto',
    label: 'Server Prisma remoto',
    hint: 'Per un server sempre acceso (VPS, Docker) con indirizzo e token',
  },
];

/**
 * Dove stanno i dati: dentro l'app (predefinito, nessun server da avviare) o su un server Prisma
 * separato. Il cambio vale dal riavvio dell'app. Nel browser (anteprima) c'è solo la prova.
 */
export function ConnectionSection() {
  const settings = useConnectionSettings();

  return (
    <section aria-labelledby="h-server" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="h-server" className={styles.sectionTitle}>
          Dati
        </h2>
        <span className={styles.sectionHint}>
          {!window.prisma
            ? 'Anteprima nel browser: le richieste passano dal proxy di Vite al server di sviluppo.'
            : 'Dove Prisma salva idee, bozze, calendario e account collegati'}
        </span>
      </div>
      {settings.data ? <ConnectionForm view={settings.data} /> : <TestRow />}
    </section>
  );
}

/** Si monta quando le impostazioni sono caricate: i campi partono dai valori salvati. */
function ConnectionForm({ view }: { view: ConnectionSettingsView }) {
  const save = useSaveConnection();
  const [mode, setMode] = useState<ConnectionMode>(view.mode);
  const [serverUrl, setServerUrl] = useState(view.serverUrl);
  const [token, setToken] = useState('');
  const pendingRestart = view.mode !== view.activeMode;
  const changed =
    mode !== view.mode || (mode === 'remoto' && (serverUrl !== view.serverUrl || token));

  return (
    <>
      <div role="radiogroup" aria-label="Dove stanno i dati" className={styles.presets}>
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={mode === option.mode}
            className={`${styles.preset} ${mode === option.mode ? styles.presetOn : ''}`}
            onClick={() => setMode(option.mode)}
          >
            <span className={styles.brandName}>{option.label}</span>
            <span className={styles.presetTag}>{option.hint}</span>
          </button>
        ))}
      </div>

      {mode === 'locale' ? (
        <span className={`${styles.accountStatus} ${styles.toolPath} mono`}>
          {view.databasePath}
        </span>
      ) : (
        <>
          <span className={styles.sectionHint}>{TOKEN_SOURCE_LABEL[view.tokenSource]}</span>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="server-url" className={styles.label}>
                Indirizzo del server Prisma
              </label>
              <input
                id="server-url"
                className={`${styles.input} mono`}
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://prisma.miodominio.it"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="api-token" className={styles.label}>
                Token del server (API_TOKEN)
              </label>
              <input
                id="api-token"
                type="password"
                className={`${styles.input} mono`}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={view.hasToken ? '•••••••• (lascia vuoto per non cambiarlo)' : ''}
                autoComplete="off"
              />
            </div>
          </div>
          <span className={styles.sectionHint}>
            Le chiavi dell’AI non vanno qui: si inseriscono nella sezione AI.
          </span>
        </>
      )}

      <div className={styles.buttons}>
        <Button
          onClick={() =>
            save.mutate(
              { mode, serverUrl, apiToken: token.trim() || undefined },
              { onSuccess: () => setToken('') },
            )
          }
          disabled={save.isPending || !changed || (mode === 'remoto' && !serverUrl)}
        >
          {save.isPending ? 'Salvo…' : 'Salva'}
        </Button>
        {pendingRestart ? (
          <>
            <Button variant="secondary" onClick={() => void window.prisma?.restart()}>
              Riavvia ora
            </Button>
            <span className={styles.sectionHint}>Il cambio vale dal prossimo avvio di Prisma</span>
          </>
        ) : (
          <TestRow />
        )}
      </div>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      ) : null}
    </>
  );
}

function TestRow() {
  const test = useTestConnection();
  return (
    <div className={styles.testRow}>
      <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
        {test.isPending ? 'Provo…' : 'Prova'}
      </Button>
      {test.isSuccess && <span className={styles.ok}>Funziona</span>}
      {test.error ? <span className={styles.error}>{errorMessage(test.error)}</span> : null}
    </div>
  );
}
