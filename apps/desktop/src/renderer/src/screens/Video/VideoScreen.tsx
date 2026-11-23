import { formatDurationMs, type VideoProject } from '@prisma-app/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import {
  useImportVideo,
  useRemoveVideo,
  useToolsStatus,
  useVideoProjects,
} from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import {
  TOOL_NEEDS,
  canUseVideo,
  fpsLabel,
  mediaUrl,
  missingTools,
  resolutionLabel,
  sizeLabel,
  projectListMeta,
} from '../../services/video';
import { TranscriptPanel } from './TranscriptPanel';
import { VideoEditor } from './VideoEditor';
import styles from './Video.module.css';

const SUBTITLE =
  'Montaggio dalla trascrizione, ritaglio 9:16 / 1:1 / 16:9, sottotitoli e FilmCraft.';

/** Editor video, passo 3a: libreria dei progetti con import e anteprima. */
export function VideoScreen() {
  if (!canUseVideo()) {
    return (
      <Page title="Editor video" subtitle={SUBTITLE}>
        <Panel label="Solo nell’app desktop">
          <p className={styles.note}>
            I video usano FFmpeg e Whisper sul computer: apri Prisma come app desktop.
          </p>
        </Panel>
      </Page>
    );
  }
  return <VideoRoute />;
}

/** `/video` mostra la libreria, `/video/:id` l'editor del progetto. */
function VideoRoute() {
  const { projectId } = useParams();
  const projects = useVideoProjects();
  if (!projectId) return <VideoLibrary />;
  const project = projects.data?.find((p) => p.id === projectId);
  if (!project) {
    return (
      <Page title="Editor video" subtitle={SUBTITLE} breadcrumb={<Link to="/video">Video</Link>}>
        <Panel label="Stato">
          <p className={styles.note}>
            {projects.isLoading ? 'Carico il progetto…' : 'Progetto non trovato.'}
          </p>
        </Panel>
      </Page>
    );
  }
  return <VideoEditor key={project.id} project={project} />;
}

function VideoLibrary() {
  const projects = useVideoProjects();
  const tools = useToolsStatus();
  const importer = useImportVideo();
  const remove = useRemoveVideo();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = projects.data ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? list[0] ?? null;
  const missingForImport = tools.data ? missingTools(tools.data, TOOL_NEEDS.import) : [];
  const missingForWork = tools.data ? missingTools(tools.data, TOOL_NEEDS.transcribe) : [];

  return (
    <Page
      title="Editor video"
      subtitle={SUBTITLE}
      actions={
        <Button
          disabled={importer.isPending || missingForImport.length > 0}
          title={missingForImport.length ? `Serve ${missingForImport.join(', ')}` : undefined}
          onClick={() =>
            importer.mutate(undefined, {
              onSuccess: (project) => project && setSelectedId(project.id),
            })
          }
        >
          {importer.isPending ? 'Leggo il video…' : 'Importa video'}
        </Button>
      }
    >
      {missingForWork.length > 0 && (
        <p className={styles.banner}>
          Mancano {missingForWork.join(', ')}: indicali in{' '}
          <Link to="/impostazioni">Impostazioni › Strumenti video</Link>.
        </p>
      )}
      {importer.error || remove.error || projects.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(importer.error ?? remove.error ?? projects.error)}
        </p>
      ) : null}

      <div className={styles.layout}>
        <section aria-labelledby="h-progetti" className={styles.list}>
          <h2 id="h-progetti" className={styles.listTitle}>
            Progetti · {list.length}
          </h2>
          {list.map((project) => (
            <button
              key={project.id}
              type="button"
              aria-pressed={project.id === selected?.id}
              className={`${styles.item} ${project.id === selected?.id ? styles.itemOn : ''}`}
              onClick={() => setSelectedId(project.id)}
            >
              <span className={styles.itemTitle}>{project.title}</span>
              <span className={`${styles.itemMeta} mono`}>{projectListMeta(project)}</span>
            </button>
          ))}
          {projects.data && list.length === 0 && (
            <p className={styles.note}>
              Nessun video: importa una registrazione per trascriverla e montarla.
            </p>
          )}
        </section>

        {selected && (
          <ProjectPreview
            key={selected.id}
            project={selected}
            removing={remove.isPending}
            onRemove={() => {
              if (
                window.confirm(`Togliere «${selected.title}» da Prisma? Il file resta sul disco.`)
              ) {
                remove.mutate(selected.id);
              }
            }}
          />
        )}
      </div>
    </Page>
  );
}

function ProjectPreview(props: { project: VideoProject; removing: boolean; onRemove: () => void }) {
  const { project } = props;
  const { source } = project;
  return (
    <section aria-label={`Anteprima di ${project.title}`} className={styles.preview}>
      <div className={styles.player}>
        <video className={styles.video} src={mediaUrl(project.id)} controls preload="metadata" />
      </div>
      <div className={styles.details}>
        <h2 className={styles.detailsTitle}>{project.title}</h2>
        <dl className={styles.meta}>
          <dt>Durata</dt>
          <dd className="mono">{formatDurationMs(source.durationMs)}</dd>
          <dt>Formato</dt>
          <dd className="mono">
            {resolutionLabel(source.width, source.height)} · {fpsLabel(source.fps)}
          </dd>
          <dt>File</dt>
          <dd className="mono">
            {source.fileName} · {sizeLabel(source.sizeBytes)}
            {source.videoCodec ? ` · ${source.videoCodec}` : ''}
            {source.hasAudio ? '' : ' · senza audio'}
          </dd>
        </dl>
        <OpenEditorButton projectId={project.id} />
        <TranscriptPanel project={project} />
        <Button variant="secondary" size={32} disabled={props.removing} onClick={props.onRemove}>
          Togli da Prisma
        </Button>
      </div>
    </section>
  );
}

function OpenEditorButton({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  return (
    <Button size={32} onClick={() => navigate(`/video/${projectId}`)}>
      Apri editor
    </Button>
  );
}
