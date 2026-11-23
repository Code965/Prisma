import { VIDEO_TOOL_LABELS, type ToolStatus } from '@prisma-app/shared';
import { Button } from '../../components/Button/Button';
import { usePickToolPath, useSetToolPath, useToolsStatus } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import { TOOL_HINTS, canUseVideo } from '../../services/video';
import styles from './Impostazioni.module.css';

const SOURCE_LABEL: Record<ToolStatus['source'], string> = {
  impostato: 'Impostato',
  rilevato: 'Rilevato',
  assente: 'Non trovato',
};

/**
 * FFmpeg, ffprobe, whisper.cpp e il modello: Prisma li cerca da sola (PATH, collegamenti di
 * winget, cartella dei modelli) e si può indicare un percorso a mano.
 */
export function VideoToolsSection() {
  const status = useToolsStatus();
  const pick = usePickToolPath();
  const reset = useSetToolPath();
  const busy = pick.isPending || reset.isPending;

  return (
    <section aria-labelledby="h-tools" className={`${styles.section} ${styles.accounts}`}>
      <div className={styles.sectionHead}>
        <h2 id="h-tools" className={styles.sectionTitle}>
          Strumenti video
        </h2>
        <span className={styles.sectionHint}>
          {canUseVideo()
            ? 'Girano sul computer: servono per importare, trascrivere e montare i video'
            : 'Disponibili solo nell’app desktop'}
        </span>
      </div>
      {(status.data ?? []).map((tool) => (
        <div key={tool.tool} className={styles.accountRow}>
          <div className={styles.accountText}>
            <span className={styles.accountName}>
              {VIDEO_TOOL_LABELS[tool.tool]}{' '}
              <span
                className={styles.accountHandle}
                style={{
                  color: tool.error ? 'var(--s-err)' : tool.path ? 'var(--s-pub)' : 'var(--muted)',
                }}
              >
                {tool.error ? 'Errore' : SOURCE_LABEL[tool.source]}
              </span>
            </span>
            <span className={`${styles.accountStatus} ${styles.toolPath} mono`}>
              {tool.path ?? TOOL_HINTS[tool.tool]}
            </span>
            {(tool.error ?? tool.detail) && (
              <span className={styles.accountNote}>{tool.error ?? tool.detail}</span>
            )}
          </div>
          <Button
            variant="secondary"
            size={32}
            disabled={busy}
            onClick={() => pick.mutate(tool.tool)}
          >
            Scegli…
          </Button>
          {tool.source === 'impostato' && (
            <button
              type="button"
              className={styles.inlineLink}
              disabled={busy}
              onClick={() => reset.mutate({ tool: tool.tool, path: null })}
            >
              Rileva da solo
            </button>
          )}
        </div>
      ))}
      {status.error || pick.error || reset.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(status.error ?? pick.error ?? reset.error)}
        </p>
      ) : null}
    </section>
  );
}
