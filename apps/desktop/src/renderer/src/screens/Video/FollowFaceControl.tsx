import type { VideoEdit, VideoProject } from '@prisma-app/shared';
import { useFaceAnalysis } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import { canFollowFace, faceCoverageLabel } from '../../services/face';
import styles from './VideoEditor.module.css';

interface FollowFaceControlProps {
  project: VideoProject;
  edit: VideoEdit;
  onChange: (edit: VideoEdit) => void;
}

/**
 * «Segui il volto» (6e): la prima volta cerca il volto nel video (MediaPipe, sul computer), poi
 * accende e spegne l'inquadratura che lo segue. Spostare il riquadro a mano lo spegne.
 */
export function FollowFaceControl({ project, edit, onChange }: FollowFaceControlProps) {
  const analysis = useFaceAnalysis(project);
  if (!canFollowFace(project, edit.format)) return null;

  if (analysis.isPending) {
    return (
      <span className={styles.followBusy} role="status">
        Cerco il volto… {analysis.percent ?? 0}%
        <button type="button" className={styles.aiClear} onClick={analysis.cancel}>
          Annulla
        </button>
      </span>
    );
  }

  const analyzed = project.faces !== null;
  return (
    <span className={styles.followControl}>
      <button
        type="button"
        aria-pressed={edit.followFace && analyzed}
        className={`${styles.format} ${edit.followFace && analyzed ? styles.formatOn : ''}`}
        title={
          project.faces
            ? faceCoverageLabel(project.faces)
            : 'Cerca il volto nel video e sposta il riquadro con morbidezza per tenerlo al centro'
        }
        onClick={() => {
          if (analyzed) onChange({ ...edit, followFace: !edit.followFace });
          else {
            analysis.mutate(undefined, {
              // Si accende solo se un volto c'è davvero.
              onSuccess: (updated) =>
                onChange({ ...edit, followFace: (updated.faces?.coverage ?? 0) > 0 }),
            });
          }
        }}
      >
        Segui il volto
      </button>
      {analysis.error ? (
        <span role="alert" className={styles.followError}>
          {errorMessage(analysis.error)}
        </span>
      ) : null}
    </span>
  );
}
