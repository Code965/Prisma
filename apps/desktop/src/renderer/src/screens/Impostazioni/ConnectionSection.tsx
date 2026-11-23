import { useState } from 'react';
import type { ConnectionSettingsView } from '../../../../main/ipc-contract';
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

/** Indirizzo del server e token API. In Electron il token resta nel processo main. */
export function ConnectionSection() {
  const settings = useConnectionSettings();

  return (
    <section aria-labelledby="h-server" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="h-server" className={styles.sectionTitle}>
          Server
        </h2>
        <span className={styles.sectionHint}>
          {!window.prisma
            ? 'Anteprima nel browser: le richieste passano dal proxy di Vite con il token del file .env.'
            : settings.data
              ? TOKEN_SOURCE_LABEL[settings.data.tokenSource]
              : 'Caricamento…'}
        </span>
      </div>
      {settings.data ? <ConnectionForm view={settings.data} /> : <TestRow />}
    </section>
  );
}

/** Si monta quando le impostazioni sono caricate: il campo parte dal valore salvato. */
function ConnectionForm({ view }: { view: ConnectionSettingsView }) {
  const save = useSaveConnection();
  const [serverUrl, setServerUrl] = useState(view.serverUrl);
  const [token, setToken] = useState('');

  return (
    <>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="server-url" className={styles.label}>
            Indirizzo
          </label>
          <input
            id="server-url"
            className={`${styles.input} mono`}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="http://127.0.0.1:4000"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="api-token" className={styles.label}>
            Token API
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
      <div className={styles.buttons}>
        <Button
          onClick={() =>
            save.mutate(
              { serverUrl, apiToken: token.trim() || undefined },
              { onSuccess: () => setToken('') },
            )
          }
          disabled={save.isPending || !serverUrl}
        >
          {save.isPending ? 'Salvo…' : 'Salva'}
        </Button>
        <TestRow />
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
        {test.isPending ? 'Provo…' : 'Prova collegamento'}
      </Button>
      {test.isSuccess && <span className={styles.ok}>Collegato</span>}
      {test.error ? <span className={styles.error}>{errorMessage(test.error)}</span> : null}
    </div>
  );
}
