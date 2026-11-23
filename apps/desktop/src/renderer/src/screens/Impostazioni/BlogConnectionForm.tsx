import type { SocialAccount } from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useConnectBlog, useTestBlog } from '../../hooks/useAccounts';
import { errorMessage } from '../../services/api/client';
import styles from './Impostazioni.module.css';

interface BlogConnectionFormProps {
  account: SocialAccount | null;
  onDone: () => void;
}

/**
 * Collegamento al blog personale tramite la Blog API (`docs/blog-api.md`): indirizzo base
 * dell'API del sito e la sua chiave. Il server di Prisma li verifica con il sito prima di
 * salvarli e conserva la chiave cifrata.
 */
export function BlogConnectionForm({ account, onDone }: BlogConnectionFormProps) {
  const connect = useConnectBlog();
  const test = useTestBlog();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const connected = account !== null && account.status !== 'scollegato';

  return (
    <div className={styles.blogForm}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="blog-url" className={styles.label}>
            Indirizzo base della Blog API
          </label>
          <input
            id="blog-url"
            className={`${styles.input} mono`}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={
              connected ? `https://${account.displayName}` : 'https://api.miosito.it/prisma'
            }
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="blog-key" className={styles.label}>
            Chiave API del sito
          </label>
          <input
            id="blog-key"
            type="password"
            className={`${styles.input} mono`}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              connected ? 'Reinseriscila per aggiornare il collegamento' : 'Almeno 32 caratteri'
            }
            autoComplete="off"
          />
        </div>
      </div>
      <span className={styles.sectionHint}>
        Il sito deve esporre la Blog API di Prisma (due rotte, descritte in docs/blog-api.md nel
        repository). La chiave è la stessa impostata sul sito: viene verificata e salvata cifrata.
      </span>
      <div className={styles.buttons}>
        <Button
          size={32}
          disabled={connect.isPending || !baseUrl.trim() || apiKey.trim().length < 32}
          onClick={() =>
            connect.mutate(
              { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() },
              {
                onSuccess: () => {
                  setApiKey('');
                  onDone();
                },
              },
            )
          }
        >
          {connect.isPending ? 'Verifico…' : 'Salva e verifica'}
        </Button>
        {connected && (
          <Button
            variant="secondary"
            size={32}
            disabled={test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending ? 'Provo…' : 'Prova collegamento'}
          </Button>
        )}
        {test.isSuccess && <span className={styles.ok}>Collegato</span>}
      </div>
      {connect.error || test.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(connect.error ?? test.error)}
        </p>
      ) : null}
    </div>
  );
}
