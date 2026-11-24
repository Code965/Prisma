import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import {
  useCreateIdea,
  useDeleteIdea,
  useGenerateContent,
  useIdeas,
  useTags,
  useUpdateIdea,
} from '../../hooks/useIdeas';
import { useNow } from '../../hooks/useNow';
import { useCreateVideo } from '../../hooks/useVideo';
import { createVideoLabel } from '../../services/create-video';
import { canUseVideo } from '../../services/video';
import { errorMessage } from '../../services/api/client';
import {
  deleteIdeaConfirm,
  filterIdeas,
  tagFilterOptions,
  togglePlatform,
  visibleIdeas,
  type TagFilter,
} from '../../services/ideas';
import { IdeaCard } from './IdeaCard';
import styles from './Idee.module.css';
import { NewIdeaPanel } from './NewIdeaPanel';

/** Schermata Idee (V3Idee): inserimento, filtro per argomento, piattaforme e generazione. */
export function IdeeScreen() {
  const navigate = useNavigate();
  const tags = useTags();
  const ideas = useIdeas();
  const createIdea = useCreateIdea();
  const updateIdea = useUpdateIdea();
  const generate = useGenerateContent();
  const deleteIdea = useDeleteIdea();
  const createVideo = useCreateVideo();
  const videoFor = (ideaId: number) =>
    createVideo.variables?.kind === 'idea' && createVideo.variables.id === ideaId;
  const [filter, setFilter] = useState<TagFilter>('tutti');
  const now = useNow();

  const all = visibleIdeas(ideas.data ?? []);
  const shown = filterIdeas(all, filter);
  const filters = tagFilterOptions(all, tags.data ?? []);

  return (
    <Page
      title="Idee"
      subtitle="Scrivi o detta un'idea grezza. Le bozze per ogni piattaforma arrivano dopo, quando premi «Genera contenuti»."
      maxWidth={1100}
    >
      <NewIdeaPanel
        tags={tags.data ?? []}
        saving={createIdea.isPending}
        error={createIdea.error}
        onSave={(input) => createIdea.mutateAsync(input)}
      />

      <div className={styles.filterBar}>
        <div role="group" aria-label="Filtra per argomento" className={styles.filters}>
          {filters.map((option) => {
            const pressed = option.key === filter;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={pressed}
                className={`${styles.filter} ${pressed ? styles.filterOn : ''}`}
                onClick={() => setFilter(option.key)}
              >
                {option.label} <span className={`${styles.filterCount} mono`}>{option.count}</span>
              </button>
            );
          })}
        </div>
        <span className={styles.metaText}>Ordinate per data · più recenti in alto</span>
      </div>

      {ideas.isLoading && <Panel label="Caricamento">Carico le idee…</Panel>}
      {ideas.error ? (
        <Panel label="Errore">
          <p role="alert" className={styles.error}>
            {errorMessage(ideas.error)}
          </p>
        </Panel>
      ) : null}
      {deleteIdea.error ? (
        <p role="alert" className={styles.error}>
          Idea non eliminata: {errorMessage(deleteIdea.error)}
        </p>
      ) : null}
      {ideas.data && shown.length === 0 && (
        <Panel label="Nessuna idea">
          <p className={styles.empty}>
            {all.length === 0
              ? 'Ancora nessuna idea: scrivi la prima qui sopra.'
              : 'Nessuna idea con questo argomento.'}
          </p>
        </Panel>
      )}

      <div className={styles.list}>
        {shown.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            now={now}
            generating={generate.isPending && generate.variables?.ideaId === idea.id}
            generateError={generate.variables?.ideaId === idea.id ? generate.error : null}
            onTogglePlatform={(platform) =>
              updateIdea.mutate({
                id: idea.id,
                update: { targetPlatforms: togglePlatform(idea.targetPlatforms, platform) },
              })
            }
            onGenerate={() =>
              generate.mutate(
                { ideaId: idea.id, platforms: idea.targetPlatforms },
                { onSuccess: (content) => navigate(`/studio/${content.id}`) },
              )
            }
            deleting={deleteIdea.isPending && deleteIdea.variables === idea.id}
            onDelete={() => window.confirm(deleteIdeaConfirm(idea)) && deleteIdea.mutate(idea.id)}
            video={
              canUseVideo()
                ? {
                    busy: createVideo.isPending,
                    active: createVideo.isPending && videoFor(idea.id),
                    label: createVideoLabel(createVideo.progress),
                    error: videoFor(idea.id) ? createVideo.error : null,
                    onCreate: () =>
                      createVideo.mutate(
                        { kind: 'idea', id: idea.id },
                        { onSuccess: (project) => navigate(`/video/${project.id}`) },
                      ),
                    onCancel: createVideo.cancel,
                  }
                : undefined
            }
          />
        ))}
      </div>
    </Page>
  );
}
