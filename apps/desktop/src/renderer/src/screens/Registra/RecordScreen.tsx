import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Page } from '../../components/Page/Page';
import { Panel } from '../../components/Panel/Panel';
import { useDevices, useRecording } from '../../hooks/useRecording';
import { timerLabel, type RecordingChoice } from '../../services/recorder';
import { canUseVideo, progressLabel } from '../../services/video';
import styles from './Registra.module.css';

/**
 * Registra (fase 6f): webcam, microfono e uno schermo o una finestra, registrati in due file
 * sincronizzati. A fine registrazione si apre l'editor, dove si sceglie il layout.
 */
export function RecordScreen() {
  if (!canUseVideo()) {
    return (
      <Page title="Registra" subtitle="Webcam, microfono e schermo, registrati in Prisma.">
        <Panel label="Non disponibile">
          <p className={styles.note}>La registrazione funziona solo nell’app desktop.</p>
        </Panel>
      </Page>
    );
  }
  return <Recorder />;
}

function Recorder() {
  const navigate = useNavigate();
  const { devices, error: devicesError, refresh } = useDevices();
  // undefined = non ancora scelto: valgono la prima webcam e il primo microfono trovati.
  const [picked, setPicked] = useState<Partial<RecordingChoice>>({ screenId: null });
  const choice: RecordingChoice = {
    cameraId:
      picked.cameraId === undefined ? (devices.cameras[0]?.deviceId ?? null) : picked.cameraId,
    micId: picked.micId === undefined ? (devices.mics[0]?.deviceId ?? null) : picked.micId,
    screenId: picked.screenId ?? null,
  };
  const recording = useRecording(choice);
  const busy = recording.phase !== 'pronto';
  const set = (patch: Partial<RecordingChoice>) =>
    setPicked((current) => ({ ...current, ...patch }));

  return (
    <Page
      title="Registra"
      subtitle="Webcam, microfono e schermo in due file sincronizzati: il layout lo scegli dopo, nell’editor."
      maxWidth={1200}
    >
      <div className={styles.layout}>
        <section aria-label="Anteprima" className={styles.preview}>
          <div className={styles.stage}>
            {recording.screen ? (
              <Preview stream={recording.screen} className={styles.screenVideo} />
            ) : (
              <div className={styles.placeholder}>Nessuno schermo: registri solo la webcam</div>
            )}
            {recording.camera?.getVideoTracks().length ? (
              <Preview
                stream={recording.camera}
                className={recording.screen ? styles.cameraPip : styles.cameraFull}
                mirror
              />
            ) : null}
            {recording.phase === 'conto' && (
              <div className={styles.countdown}>{recording.countdown}</div>
            )}
            {recording.phase === 'registra' && (
              <div className={`${styles.live} mono`}>
                <span className={styles.dot} aria-hidden="true" />
                REC {timerLabel(recording.elapsedMs)}
              </div>
            )}
          </div>
          <div className={styles.controls}>
            {recording.phase === 'pronto' && (
              <Button size={40} disabled={!recording.ready} onClick={() => void recording.start()}>
                Registra
              </Button>
            )}
            {recording.phase === 'registra' && (
              <>
                <Button
                  size={40}
                  onClick={() =>
                    void recording
                      .stop()
                      .then((project) => project && navigate(`/video/${project.id}`))
                  }
                >
                  Ferma e apri nell’editor
                </Button>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => void recording.cancel()}
                >
                  Annulla
                </button>
              </>
            )}
            {recording.phase === 'salva' && (
              <span className={styles.note} role="status">
                {progressLabel(recording.saving) === 'Avvio…'
                  ? 'Salvo la registrazione…'
                  : progressLabel(recording.saving)}
              </span>
            )}
            {!recording.ready && recording.phase === 'pronto' && (
              <span className={styles.note}>Scegli almeno la webcam o uno schermo</span>
            )}
          </div>
          {recording.error || devicesError ? (
            <p role="alert" className={styles.error}>
              {recording.error ?? devicesError}
            </p>
          ) : null}
        </section>

        <aside aria-label="Dispositivi" className={styles.side}>
          <label className={styles.field}>
            Webcam
            <select
              className={styles.select}
              disabled={busy}
              value={choice.cameraId ?? ''}
              onChange={(e) => set({ cameraId: e.target.value || null })}
            >
              <option value="">Nessuna</option>
              {devices.cameras.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Webcam ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Microfono
            <select
              className={styles.select}
              disabled={busy}
              value={choice.micId ?? ''}
              onChange={(e) => set({ micId: e.target.value || null })}
            >
              <option value="">Nessuno</option>
              {devices.mics.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microfono ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.field}>
            <span>
              Schermo o finestra{' '}
              <button
                type="button"
                className={styles.link}
                disabled={busy}
                onClick={() => void refresh()}
              >
                Aggiorna
              </button>
            </span>
            <div className={styles.sources}>
              <button
                type="button"
                className={`${styles.source} ${choice.screenId === null ? styles.sourceOn : ''}`}
                disabled={busy}
                onClick={() => set({ screenId: null })}
              >
                <span className={styles.noScreen}>Nessuno</span>
              </button>
              {devices.screens.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className={`${styles.source} ${choice.screenId === source.id ? styles.sourceOn : ''}`}
                  disabled={busy}
                  title={source.name}
                  onClick={() => set({ screenId: source.id })}
                >
                  <img src={source.thumbnail} alt="" />
                  <span>{source.kind === 'screen' ? 'Schermo intero' : source.name}</span>
                </button>
              ))}
            </div>
          </div>
          <p className={styles.note}>
            1080p a 30 fps. Webcam e schermo restano due file: nell’editor scegli «Solo tu», «Solo
            schermo», «Schermo e te nell’angolo» o, in 9:16, «Diviso».
          </p>
        </aside>
      </div>
    </Page>
  );
}

function Preview({
  stream,
  className,
  mirror,
}: {
  stream: MediaStream;
  className?: string;
  mirror?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={video}
      className={className}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
      autoPlay
      muted
      playsInline
    />
  );
}
