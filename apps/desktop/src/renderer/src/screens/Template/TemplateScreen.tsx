import type { BrandKit } from '@prisma-app/shared';
import { useState } from 'react';
import { Page } from '../../components/Page/Page';
import { useBrand } from '../../hooks/brand';
import { useBrandKit } from '../../hooks/useBrandKit';
import { errorMessage } from '../../services/api/client';
import { kitDraft, type KitDraft } from '../../services/brand-kit';
import { BrandKitPanel } from './BrandKitPanel';
import { Gallery } from './Gallery';
import styles from './Template.module.css';
import { VoicePanel } from './VoicePanel';

/** Template e brand kit (V3Template): galleria, colori, font, logo e voce del brand. */
export function TemplateScreen() {
  const { brand } = useBrand();
  const kit = useBrandKit();

  return (
    <Page
      title="Template e brand kit"
      subtitle={
        brand
          ? `Brand: ${brand.name} · tutto quello che generi usa questi colori, font e voce`
          : undefined
      }
      gap={18}
    >
      {kit.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(kit.error)}
        </p>
      ) : null}
      {kit.data && brand && <TemplateBody key={brand.id} kit={kit.data} />}
    </Page>
  );
}

/** La bozza dei colori vive qui: la galleria la mostra mentre la modifichi. */
function TemplateBody({ kit }: { kit: BrandKit }) {
  const [draft, setDraft] = useState<KitDraft>(() => kitDraft(kit));
  return (
    <>
      <Gallery draft={draft} />
      <div className={styles.columns}>
        <BrandKitPanel kit={kit} draft={draft} onChange={setDraft} />
        <VoicePanel kit={kit} />
      </div>
    </>
  );
}
