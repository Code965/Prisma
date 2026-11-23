import { PLATFORM_LABELS } from '@prisma-app/shared';
import { Fragment, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { Page } from '../../components/Page/Page';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useBrand } from '../../hooks/brand';
import { useConnectAccount, useSocialAccounts } from '../../hooks/useAccounts';
import { useNow } from '../../hooks/useNow';
import { accountRows, oauthPlatform } from '../../services/accounts';
import { errorMessage } from '../../services/api/client';
import { BlogConnectionForm } from './BlogConnectionForm';
import { ConnectionSection } from './ConnectionSection';
import { UpdatesSection } from './UpdatesSection';
import { VideoToolsSection } from './VideoToolsSection';
import styles from './Impostazioni.module.css';

/** Impostazioni (V3Impostazioni), per ora con le parti che servono alla fase 1. */
export function ImpostazioniScreen() {
  const { brand, brands, selectBrand } = useBrand();
  const accounts = useSocialAccounts();
  const connect = useConnectAccount();
  const now = useNow();
  const rows = accountRows(accounts.data ?? [], now);
  const [blogOpen, setBlogOpen] = useState(false);

  return (
    <Page title="Impostazioni">
      <ConnectionSection />

      <section aria-labelledby="h-brand" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="h-brand" className={styles.sectionTitle}>
            Brand
          </h2>
          <span className={styles.sectionHint}>
            Ogni brand ha i suoi account, template, voce e calendario
          </span>
        </div>
        <div role="radiogroup" aria-label="Brand attivo" className={styles.brands}>
          {brands.map((b) => {
            const active = b.id === brand?.id;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`${styles.brand} ${active ? styles.brandOn : ''}`}
                onClick={() => selectBrand(b.id)}
              >
                <span className={`${styles.brandAvatar} ${active ? styles.brandAvatarOn : ''}`}>
                  {b.initials}
                </span>
                <span className={styles.brandText}>
                  <span className={styles.brandName}>{b.name}</span>
                  <span className={styles.sectionHint}>Fuso orario {b.timezone}</span>
                </span>
              </button>
            );
          })}
          {brands.length === 0 && <span className={styles.sectionHint}>Nessun brand caricato</span>}
        </div>
      </section>

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
              </div>
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
                  disabled={connect.isPending || !brand}
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
        {accounts.error ? (
          <p role="alert" className={styles.error}>
            {errorMessage(accounts.error)}
          </p>
        ) : null}
      </section>
      <VideoToolsSection />
      <UpdatesSection />
    </Page>
  );
}
