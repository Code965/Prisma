import { PLATFORM_LABELS, type AppCredentialKey } from '@prisma-app/shared';
import { Fragment, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useBrand } from '../../hooks/brand';
import { useConnectAccount, useSocialAccounts } from '../../hooks/useAccounts';
import { useAppCredentials } from '../../hooks/useAppCredentials';
import { useNow } from '../../hooks/useNow';
import { accountRows, oauthPlatform } from '../../services/accounts';
import {
  APP_GUIDES,
  appKeyFor,
  appStatusLabel,
  isAppConfigured,
} from '../../services/app-credentials';
import { errorMessage } from '../../services/api/client';
import { AppCredentialsForm } from './AppCredentialsForm';
import { BlogConnectionForm } from './BlogConnectionForm';
import styles from './Impostazioni.module.css';

/**
 * Account collegati (con l'app sviluppatore di ogni piattaforma) e archivio R2. Nelle
 * Impostazioni e nella configurazione guidata del primo avvio.
 */
export function AccountsSection() {
  const { brand } = useBrand();
  const accounts = useSocialAccounts();
  const connect = useConnectAccount();
  const now = useNow();
  const rows = accountRows(accounts.data ?? [], now);
  const [blogOpen, setBlogOpen] = useState(false);
  const apps = useAppCredentials();
  const [openApp, setOpenApp] = useState<AppCredentialKey | null>(null);
  const appView = (key: AppCredentialKey | null) => apps.data?.find((view) => view.key === key);
  const toggleApp = (key: AppCredentialKey) =>
    setOpenApp((current) => (current === key ? null : key));

  return (
    <>
      <section aria-labelledby="h-acc" className={`${styles.section} ${styles.accounts}`}>
        <h2 id="h-acc" className={styles.sectionTitle}>
          Account collegati
        </h2>
        {rows.map((row) => (
          <Fragment key={row.platform}>
            <div className={styles.accountRow}>
              <PlatformIcon platform={row.platform} size={32} />
              <div className={styles.accountText}>
                <span className={styles.accountName}>
                  {PLATFORM_LABELS[row.platform]}{' '}
                  {row.account && (
                    <span className={styles.accountHandle}>{row.account.displayName}</span>
                  )}
                </span>
                <span className={styles.accountStatus} style={{ color: row.statusColor }}>
                  {row.statusLabel}
                  {row.note && <span className={styles.accountNote}> · {row.note}</span>}
                </span>
                {appKeyFor(row.platform) && apps.data && (
                  <span className={styles.accountStatus}>
                    {appStatusLabel(appView(appKeyFor(row.platform)))}
                  </span>
                )}
              </div>
              {appKeyFor(row.platform) && apps.data && (
                <Button
                  variant="secondary"
                  size={32}
                  aria-expanded={openApp === appKeyFor(row.platform)}
                  onClick={() => toggleApp(appKeyFor(row.platform)!)}
                >
                  {openApp === appKeyFor(row.platform) ? 'Chiudi' : 'App'}
                </Button>
              )}
              {row.action === 'configura' && (
                <Button
                  variant="secondary"
                  size={32}
                  disabled={!brand}
                  aria-expanded={blogOpen}
                  onClick={() => setBlogOpen((open) => !open)}
                >
                  {blogOpen ? 'Chiudi' : row.account ? 'Modifica' : 'Configura'}
                </Button>
              )}
              {(row.action === 'collega' || row.action === 'ricollega') && (
                <Button
                  variant="secondary"
                  size={32}
                  disabled={
                    connect.isPending ||
                    !brand ||
                    (Boolean(apps.data) && !isAppConfigured(appView(appKeyFor(row.platform))))
                  }
                  title={
                    apps.data && !isAppConfigured(appView(appKeyFor(row.platform)))
                      ? 'Configura prima l’app della piattaforma'
                      : undefined
                  }
                  onClick={() => {
                    const platform = oauthPlatform(row.platform);
                    if (platform) connect.mutate(platform);
                  }}
                >
                  {row.action === 'collega' ? 'Collega' : 'Ricollega'}
                </Button>
              )}
            </div>
            {row.action === 'configura' && blogOpen && (
              <BlogConnectionForm account={row.account} onDone={() => setBlogOpen(false)} />
            )}
            {appKeyFor(row.platform) && openApp === appKeyFor(row.platform) && appView(openApp) && (
              <AppCredentialsForm view={appView(openApp)!} onDone={() => setOpenApp(null)} />
            )}
          </Fragment>
        ))}
        {connect.isSuccess && (
          <p className={styles.sectionHint}>
            Completa l'autorizzazione nel browser, poi torna qui:{' '}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => void accounts.refetch()}
            >
              aggiorna l'elenco
            </button>
            .
          </p>
        )}
        {connect.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(connect.error)}
          </p>
        ) : null}
        {apps.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(apps.error)}
          </p>
        ) : null}
        {accounts.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(accounts.error)}
          </p>
        ) : null}
      </section>
      {apps.data && (
        <section aria-labelledby="h-r2" className={`${styles.section} ${styles.accounts}`}>
          <div className={styles.sectionHead}>
            <h2 id="h-r2" className={styles.sectionTitle}>
              Archivio file
            </h2>
            <span className={styles.sectionHint}>
              Caroselli e video da pubblicare vanno su {APP_GUIDES.r2.label}: le piattaforme li
              scaricano da lì
            </span>
          </div>
          <div className={styles.accountRow}>
            <div className={styles.accountText}>
              <span className={styles.accountName}>{APP_GUIDES.r2.label}</span>
              <span className={styles.accountStatus}>
                {isAppConfigured(appView('r2'))
                  ? `Bucket ${appView('r2')?.r2?.bucket ?? ''}${appView('r2')?.source === 'env' ? ' (dal file .env)' : ''}`
                  : 'Non configurato'}
              </span>
            </div>
            <Button
              variant="secondary"
              size={32}
              aria-expanded={openApp === 'r2'}
              onClick={() => toggleApp('r2')}
            >
              {openApp === 'r2' ? 'Chiudi' : 'Configura'}
            </Button>
          </div>
          {openApp === 'r2' && appView('r2') && (
            <AppCredentialsForm view={appView('r2')!} onDone={() => setOpenApp(null)} />
          )}
        </section>
      )}
    </>
  );
}
