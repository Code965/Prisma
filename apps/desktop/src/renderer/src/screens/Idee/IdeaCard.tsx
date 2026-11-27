import { PLATFORMS, PLATFORM_LABELS, type Idea, type Platform } from '@prisma-app/shared';
import { Button } from '../../components/Button/Button';
import { Icon } from '../../components/icons/Icon';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { errorMessage } from '../../services/api/client';
import { ideaMeta, platformCountLabel } from '../../services/ideas';
import styles from './Idee.module.css';

interface IdeaCardProps {
  idea: Idea;
  now: Date;
  generating: boolean;
  generateError: unknown;
  onTogglePlatform: (platform: Platform) => void;
  onGenerate: () => void;
  deleting: boolean;
  onDelete: () => void;
  /** «Crea video»: assente fuori dall'app desktop. */
  video?: {
    busy: boolean;
    /** Questa idea è quella in lavorazione. */
    active: boolean;
    label: string;
    error: unknown;
    onCreate: () => void;
    onCancel: () => void;
  };
}

/** Una riga della lista idee: testo, argomento, piattaforme scelte e "Genera contenuti". */
export function IdeaCard({
  idea,
  now,
  generating,
  generateError,
  onTogglePlatform,
  onGenerate,
  deleting,
  onDelete,
  video,
}: IdeaCardProps) {
  const count = idea.targetPlatforms.length;

  return (
    <article className={styles.card}>
      <div className={styles.cardText}>
        <h2 className={styles.cardTitle}>{idea.text}</h2>
        <div className={styles.cardMeta}>
          {idea.tags.map((tag) => (
            <span key={tag.id} className={styles.tagBadge}>
              {tag.name}
            </span>
          ))}
          <span className={styles.metaText}>{ideaMeta(idea, now)}</span>
          {idea.inspiration && (
            <span className={styles.metaText}>
              · ispirata da{' '}
              {idea.inspiration.url ? (
                <a
                  href={idea.inspiration.url}
                  target="_blank"
                  rel="noreferrer"
                  title={idea.inspiration.title}
                  className={styles.metaLink}
                >
                  {idea.inspiration.label}
                </a>
              ) : (
                <span title={idea.inspiration.title}>{idea.inspiration.label}</span>
              )}
            </span>
          )}
          {idea.status === 'in_lavorazione' && (
            <span className={styles.metaText}>· in lavorazione</span>
          )}
        </div>
      </div>

      <div className={styles.cardActions}>
        <div role="group" aria-label={`Piattaforme per ${idea.text}`} className={styles.platforms}>
          {PLATFORMS.map((platform) => {
            const selected = idea.targetPlatforms.includes(platform);
            const name = `${PLATFORM_LABELS[platform]}${selected ? ' selezionato' : ''}`;
            return (
              <button
                key={platform}
                type="button"
                aria-pressed={selected}
                aria-label={name}
                title={name}
                className={`${styles.platformToggle} ${selected ? styles.platformOn : ''}`}
                onClick={() => onTogglePlatform(platform)}
              >
                <PlatformIcon platform={platform} size={26} />
              </button>
            );
          })}
        </div>
        <Button
          size={40}
          icon={<Icon name="sparkle" size={14} strokeWidth={2} />}
          disabled={count === 0 || generating}
          onClick={onGenerate}
          title={count === 0 ? 'Scegli almeno una piattaforma' : undefined}
        >
          {generating ? 'Genero le bozze…' : `Genera contenuti · ${platformCountLabel(count)}`}
        </Button>
        {video && (
          <Button
            variant="secondary"
            size={40}
            icon={<Icon name="video" size={14} />}
            disabled={video.busy || generating}
            onClick={video.onCreate}
            title="Copione dell’AI, voce e slide del brand kit: un video verticale di circa 45 secondi"
          >
            {video.active ? video.label : 'Crea video'}
          </Button>
        )}
        {video?.active && (
          <button type="button" className={styles.inlineLink} onClick={video.onCancel}>
            Annulla
          </button>
        )}
        <button
          type="button"
          className={styles.deleteButton}
          aria-label={`Elimina l'idea ${idea.text}`}
          title="Elimina l'idea"
          disabled={deleting || generating}
          onClick={onDelete}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      {video?.error ? (
        <p role="alert" className={`${styles.error} ${styles.cardError}`}>
          Video non creato: {errorMessage(video.error)}
        </p>
      ) : null}
      {generateError ? (
        <p role="alert" className={`${styles.error} ${styles.cardError}`}>
          {errorMessage(generateError)}
        </p>
      ) : null}
    </article>
  );
}
