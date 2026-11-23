import type { AppCredentialView } from '@prisma-app/shared';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useRemoveAppCredentials, useSaveAppCredentials } from '../../hooks/useAppCredentials';
import { APP_GUIDES } from '../../services/app-credentials';
import { errorMessage } from '../../services/api/client';
import styles from './Impostazioni.module.css';

interface AppCredentialsFormProps {
  view: AppCredentialView;
  onDone: () => void;
}

/**
 * App sviluppatore di una piattaforma (o archivio R2): guida passo passo, indirizzo di ritorno da
 * copiare e campi. Il segreto va al server cifrato e non torna indietro: vuoto = tieni quello.
 */
export function AppCredentialsForm({ view, onDone }: AppCredentialsFormProps) {
  const guide = APP_GUIDES[view.key];
  const save = useSaveAppCredentials();
  const remove = useRemoveAppCredentials();
  const [publicId, setPublicId] = useState(view.publicId ?? '');
  const [secret, setSecret] = useState('');
  const [accountId, setAccountId] = useState(view.r2?.accountId ?? '');
  const [bucket, setBucket] = useState(view.r2?.bucket ?? '');
  const [publicBaseUrl, setPublicBaseUrl] = useState(view.r2?.publicBaseUrl ?? '');
  const [copied, setCopied] = useState(false);
  const isR2 = view.key === 'r2';
  const secretKept = view.source === 'impostazioni' && view.hasSecret;
  const busy = save.isPending || remove.isPending;

  const body = isR2
    ? {
        accountId,
        bucket,
        accessKeyId: publicId,
        ...(secret.trim() ? { secretAccessKey: secret } : {}),
        ...(publicBaseUrl.trim() ? { publicBaseUrl } : {}),
      }
    : { clientId: publicId, ...(secret.trim() ? { clientSecret: secret } : {}) };
  const complete =
    publicId.trim() !== '' &&
    (secret.trim() !== '' || secretKept) &&
    (!isR2 || (accountId.trim() !== '' && bucket.trim() !== ''));

  return (
    <div className={styles.blogForm}>
      <ol className={styles.guide}>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          size={32}
          onClick={() => void window.prisma?.openExternal(guide.portalUrl)}
          disabled={!window.prisma}
        >
          Apri la pagina di {guide.label}
        </Button>
      </div>

      {guide.registerRedirect && view.redirectUri && (
        <div className={styles.field}>
          <span className={styles.label}>Indirizzo di ritorno da registrare</span>
          <div className={styles.copyRow}>
            <code className={`${styles.copyValue} mono`}>{view.redirectUri}</code>
            <Button
              variant="secondary"
              size={32}
              onClick={() =>
                void navigator.clipboard
                  .writeText(view.redirectUri ?? '')
                  .then(() => setCopied(true))
              }
            >
              {copied ? 'Copiato' : 'Copia'}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.fields}>
        {isR2 && (
          <>
            <Field id="r2-account" label="Account ID" value={accountId} onChange={setAccountId} />
            <Field id="r2-bucket" label="Bucket" value={bucket} onChange={setBucket} />
          </>
        )}
        <Field
          id={`${view.key}-id`}
          label={guide.idLabel}
          value={publicId}
          onChange={setPublicId}
        />
        <Field
          id={`${view.key}-secret`}
          label={guide.secretLabel}
          value={secret}
          onChange={setSecret}
          secret
          placeholder={secretKept ? 'Salvato: lascia vuoto per tenerlo' : ''}
        />
        {isR2 && (
          <Field
            id="r2-public"
            label="Indirizzo pubblico del bucket"
            value={publicBaseUrl}
            onChange={setPublicBaseUrl}
            placeholder="https://pub-….r2.dev"
          />
        )}
      </div>

      <div className={styles.buttons}>
        <Button
          size={32}
          disabled={busy || !complete}
          onClick={() => save.mutate({ key: view.key, body }, { onSuccess: () => onDone() })}
        >
          {save.isPending ? 'Salvo…' : 'Salva'}
        </Button>
        {view.source === 'impostazioni' && (
          <Button
            variant="secondary"
            size={32}
            disabled={busy}
            onClick={() =>
              window.confirm(`Togliere le credenziali di ${guide.label}?`) &&
              remove.mutate(view.key)
            }
          >
            Togli
          </Button>
        )}
      </div>
      {save.error || remove.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error ?? remove.error)}
        </p>
      ) : null}
    </div>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  secret?: boolean;
  placeholder?: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={props.id} className={styles.label}>
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.secret ? 'password' : 'text'}
        className={`${styles.input} mono`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoComplete="off"
      />
    </div>
  );
}
