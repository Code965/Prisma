import type { Platform } from '@prisma-app/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import { useContent, useIdea } from '../../hooks/useStudio';
import { errorMessage } from '../../services/api/client';
import { sortVariants } from '../../services/studio';
import { StudioBody } from './StudioBody';
import styles from './Studio.module.css';

/** Studio contenuto (V3Studio): carica il contenuto e sceglie la variant della tab attiva. */
export function StudioScreen() {
  const { contentId } = useParams();
  const id = Number(contentId);
  const validId = Number.isInteger(id) && id > 0 ? id : null;
  const content = useContent(validId);
  const idea = useIdea(content.data?.ideaId ?? null);
  const [platform, setPlatform] = useState<Platform | null>(null);

  if (!validId || content.error || !content.data) {
    return (
      <Page
        title="Studio contenuto"
        subtitle="Bozze per piattaforma con anteprima nel feed e chat per modificarle scrivendo."
        breadcrumb={<Link to="/idee">Idee</Link>}
      >
        <Panel label="Stato">
          <p className={styles.note}>
            {!validId
              ? 'Apri un contenuto da Idee con «Genera contenuti».'
              : content.error
                ? errorMessage(content.error)
                : 'Carico il contenuto…'}
          </p>
        </Panel>
      </Page>
    );
  }

  const variants = sortVariants(content.data.variants);
  const variant = variants.find((v) => v.platform === platform) ?? variants[0];
  if (!variant) {
    return (
      <Page title={content.data.title} breadcrumb={<Link to="/idee">Idee</Link>}>
        <Panel label="Nessuna bozza">
          <p className={styles.note}>Questo contenuto non ha ancora bozze.</p>
        </Panel>
      </Page>
    );
  }

  return (
    <StudioBody
      // La chiave include la versione: dopo ogni salvataggio o modifica dell'LLM il modulo
      // riparte dal testo salvato, senza sincronizzare stato a mano.
      key={`${variant.id}:${variant.version}`}
      content={content.data}
      variants={variants}
      variant={variant}
      tags={idea.data?.tags ?? []}
      onSelectPlatform={setPlatform}
    />
  );
}
