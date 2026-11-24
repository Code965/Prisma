import { AUDIO_LIMITS, editedTimeMs, type VideoEdit, type VideoProject } from '@prisma-app/shared';
import { useEffect, useRef } from 'react';
import { useMusic, useSetMusicDir } from '../../hooks/useVideo';
import { errorMessage } from '../../services/api/client';
import {
  audioSummary,
  isSpeakingAt,
  missingTrack,
  musicPreviewGain,
  musicPreviewSeconds,
  selectTrack,
  trackLabel,
  volumeLabel,
} from '../../services/audio';
import { musicUrl } from '../../services/video';
import styles from './VideoEditor.module.css';

interface AudioPanelProps {
  project: VideoProject;
  edit: VideoEdit;
  onChange: (edit: VideoEdit) => void;
  playing: boolean;
  sourceMs: number;
  totalMs: number;
}

/**
 * Pannello «Audio» (6b): voce ripulita, volume uniforme e musica dalla cartella scelta nelle
 * Impostazioni. La musica si sente anche nell'anteprima, abbassata mentre si parla.
 */
export function AudioPanel({
  project,
  edit,
  onChange,
  playing,
  sourceMs,
  totalMs,
}: AudioPanelProps) {
  const music = useMusic();
  const setDir = useSetMusicDir();
  const audio = edit.audio;
  const tracks = music.data?.tracks ?? [];
  const setAudio = (next: Partial<VideoEdit['audio']>) =>
    onChange({ ...edit, audio: { ...audio, ...next } });

  return (
    <div className={styles.aiPanel}>
      <span className={styles.aiPanelTitle}>
        Audio <span className={styles.audioSummary}>· {audioSummary(audio)}</span>
      </span>
      {project.source.hasAudio && (
        <>
          <label className={styles.aiRow}>
            <input
              type="checkbox"
              className={styles.check}
              checked={audio.clean}
              onChange={(e) => setAudio({ clean: e.target.checked })}
            />
            Pulisci la voce: toglie ronzio e rumore di fondo, soprattutto nelle pause
          </label>
          <label className={styles.aiRow}>
            <input
              type="checkbox"
              className={styles.check}
              checked={audio.normalize}
              onChange={(e) => setAudio({ normalize: e.target.checked })}
            />
            Volume uniforme a −14 LUFS, il livello di YouTube, Instagram e TikTok
          </label>
        </>
      )}

      <div className={styles.aiRow}>
        Musica
        {music.data?.dir ? (
          <select
            className={styles.audioSelect}
            value={audio.music?.path ?? ''}
            onChange={(e) =>
              onChange({ ...edit, audio: selectTrack(audio, tracks, e.target.value) })
            }
          >
            <option value="">Nessuna</option>
            {missingTrack(audio, tracks) && (
              <option value={audio.music!.path}>{audio.music!.fileName} (non trovato)</option>
            )}
            {tracks.map((track) => (
              <option key={track.path} value={track.path}>
                {trackLabel(track)}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className={styles.aiClear}
            disabled={setDir.isPending}
            onClick={() => setDir.mutate('pick')}
          >
            Scegli la cartella della tua musica…
          </button>
        )}
      </div>
      {music.data?.dir && tracks.length === 0 && (
        <span className={styles.audioNote}>
          {music.data.error ?? 'Nessun brano nella cartella (MP3, WAV, M4A, FLAC, OGG)'}
        </span>
      )}
      {audio.music && (
        <>
          <label className={styles.aiRow}>
            Volume
            <input
              type="range"
              className={styles.audioRange}
              min={AUDIO_LIMITS.musicVolumeMinDb}
              max={AUDIO_LIMITS.musicVolumeMaxDb}
              step={1}
              value={audio.music.volumeDb}
              onChange={(e) =>
                setAudio({ music: { ...audio.music!, volumeDb: Number(e.target.value) } })
              }
            />
            <span className="mono">{volumeLabel(audio.music.volumeDb)}</span>
          </label>
          <label className={styles.aiRow}>
            <input
              type="checkbox"
              className={styles.check}
              checked={audio.music.ducking}
              onChange={(e) => setAudio({ music: { ...audio.music!, ducking: e.target.checked } })}
            />
            Abbassa la musica mentre parli
          </label>
          {missingTrack(audio, tracks) && (
            <span role="alert" className={styles.audioNote}>
              Il brano non è più nella cartella della musica: sceglilo di nuovo.
            </span>
          )}
          <MusicPreview
            project={project}
            edit={edit}
            playing={playing}
            sourceMs={sourceMs}
            totalMs={totalMs}
          />
        </>
      )}
      <span className={styles.audioNote}>
        Pulizia e volume si sentono nel video esportato; nell’anteprima senti la musica.
      </span>
      {music.error || setDir.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(music.error ?? setDir.error)}
        </p>
      ) : null}
    </div>
  );
}

/** Lettore nascosto della musica, al passo con il video montato. */
function MusicPreview({
  project,
  edit,
  playing,
  sourceMs,
  totalMs,
}: Omit<AudioPanelProps, 'onChange'>) {
  const element = useRef<HTMLAudioElement>(null);
  const music = edit.audio.music!;
  const editedMs = editedTimeMs(edit.cuts, sourceMs);
  const speaking = isSpeakingAt(project.transcript?.words ?? [], sourceMs);

  useEffect(() => {
    const audio = element.current;
    if (!audio) return;
    audio.volume = musicPreviewGain(music, { speaking, editedMs, totalMs });
    const target = musicPreviewSeconds(editedMs, music);
    if (Math.abs(audio.currentTime - target) > 0.35) audio.currentTime = target;
    if (playing && audio.paused) void audio.play().catch(() => {});
    if (!playing && !audio.paused) audio.pause();
  }, [music, playing, speaking, editedMs, totalMs]);

  return <audio ref={element} src={musicUrl(music.fileName)} preload="auto" hidden />;
}
