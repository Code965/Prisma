import { Page } from '../../components/Page/Page';
import { useBrand } from '../../hooks/brand';
import { useOpenSetup } from '../../hooks/setup-context';
import { Button } from '../../components/Button/Button';
import { AccountsSection } from './AccountsSection';
import { AiSettingsSection } from './AiSettingsSection';
import { BackgroundSection } from './BackgroundSection';
import { ConnectionSection } from './ConnectionSection';
import { UpdatesSection } from './UpdatesSection';
import { VideoToolsSection } from './VideoToolsSection';
import styles from './Impostazioni.module.css';

/** Impostazioni (V3Impostazioni), per ora con le parti che servono alla fase 1. */
export function ImpostazioniScreen() {
  const { brand, brands, selectBrand } = useBrand();
  const openSetup = useOpenSetup();

  return (
    <Page title="Impostazioni">
      <ConnectionSection />
      <AiSettingsSection />

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
        <div className={styles.buttons}>
          <Button variant="secondary" size={32} onClick={openSetup}>
            Apri la configurazione guidata
          </Button>
          <span className={styles.sectionHint}>Brand, argomenti, AI e account, passo passo</span>
        </div>
      </section>

      <AccountsSection />
      <VideoToolsSection />
      <BackgroundSection />
      <UpdatesSection />
    </Page>
  );
}
