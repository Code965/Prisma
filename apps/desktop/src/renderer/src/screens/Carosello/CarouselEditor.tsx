import { PLATFORM_LABELS, type Content, type Variant } from '@prisma-app/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import { useBrandKit } from '../../hooks/useBrandKit';
import { useGenerateCarousel } from '../../hooks/useCarousel';
import { useSaveVariant } from '../../hooks/useStudio';
import { errorMessage } from '../../services/api/client';
import { starterCarousel } from '../../services/carousel';
import { isReadOnly } from '../../services/studio';
import styles from './Carosello.module.css';
import { CarouselBody } from './CarouselBody';
import type { ChatEntry } from './CarouselChat';

interface CarouselEditorProps {
  content: Content;
  variant: Variant;
}

/**
 * Stato che sopravvive ai salvataggi (slide selezionata e conversazione); il corpo con la bozza
 * è montato con chiave `id:version` e riparte dalle slide salvate dopo ogni modifica.
 */
export function CarouselEditor({ content, variant }: CarouselEditorProps) {
  const [selected, setSelected] = useState(0);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const carousel = variant.metadata.carousel;

  if (!carousel) return <EmptyEditor content={content} variant={variant} />;
  return (
    <CarouselBody
      key={`${variant.id}:${variant.version}`}
      content={content}
      variant={variant}
      saved={carousel}
      selected={Math.min(selected, carousel.slides.length - 1)}
      onSelect={setSelected}
      chat={chat}
      onChat={setChat}
    />
  );
}

function EmptyEditor({ content, variant }: CarouselEditorProps) {
  const kit = useBrandKit().data;
  const generate = useGenerateCarousel(content.id);
  const save = useSaveVariant(content.id);
  const readOnly = isReadOnly(variant.status);
  const busy = generate.isPending || save.isPending;
  const label = PLATFORM_LABELS[variant.platform];

  return (
    <Page
      title="Editor carosello"
      breadcrumb={
        <>
          <Link to={`/studio/${content.id}`}>{content.title}</Link> / Carosello
        </>
      }
    >
      <Panel label="Nuovo carosello">
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            La bozza {label} non ha ancora slide. Puoi ricavarle dal testo del post con DeepSeek o
            partire da tre slide da completare.
          </p>
          {readOnly ? (
            <p className={styles.note}>
              Bozza in coda o già pubblicata: per modificarla annulla prima la programmazione.
            </p>
          ) : (
            <div className={styles.emptyActions}>
              <Button
                disabled={busy || !variant.body.trim()}
                title={
                  variant.body.trim() ? undefined : 'Scrivi prima il testo del post nello Studio'
                }
                onClick={() => generate.mutate(variant)}
              >
                {generate.isPending
                  ? 'DeepSeek sta preparando le slide…'
                  : 'Genera dal testo del post'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  save.mutate({
                    variant,
                    draft: {
                      body: variant.body,
                      metadata: {
                        ...variant.metadata,
                        carousel: starterCarousel(content.title, kit?.carouselTemplate),
                      },
                    },
                  })
                }
              >
                Parti da zero
              </Button>
            </div>
          )}
          <p className={styles.note}>
            Creare le slide riporta la bozza in revisione: andrà riapprovata prima di pubblicarla.
          </p>
          {generate.error || save.error ? (
            <p role="alert" className={styles.error}>
              {errorMessage(generate.error ?? save.error)}
            </p>
          ) : null}
        </div>
      </Panel>
    </Page>
  );
}
