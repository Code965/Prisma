import {
  AUDIO_LIMITS,
  dbToGain,
  musicFromTrack,
  type MusicTrack,
  type TranscriptWord,
  type VideoAudio,
  type VideoMusic,
} from '@prisma-app/shared';

/**
 * Audio nell'editor (fase 6b). Pulizia e volume uniforme si sentono solo nel video esportato
 * (FFmpeg); nell'anteprima si sente la musica, al volume scelto e abbassata mentre si parla,
 * come farà il render.
 */

/** Si sta parlando: c'è una parola della trascrizione in questo istante del sorgente. */
export function isSpeakingAt(words: readonly TranscriptWord[], sourceMs: number): boolean {
  return words.some((w) => w.startMs - 80 <= sourceMs && sourceMs <= w.endMs + 250);
}

/** Punto del brano per un istante del video montato: il brano ricomincia se è più corto. */
export function musicPreviewSeconds(editedMs: number, music: VideoMusic): number {
  return (editedMs % music.durationMs) / 1000;
}

/** Volume dell'anteprima: volume scelto, ducking mentre si parla, dissolvenze a inizio e fine. */
export function musicPreviewGain(
  music: VideoMusic,
  options: { speaking: boolean; editedMs: number; totalMs: number },
): number {
  const ducked = music.ducking && options.speaking ? -13 : 0;
  const fadeIn = Math.min(1, options.editedMs / AUDIO_LIMITS.fadeInMs);
  const fadeOut = Math.min(
    1,
    Math.max(0, options.totalMs - options.editedMs) / AUDIO_LIMITS.fadeOutMs,
  );
  return dbToGain(music.volumeDb + ducked) * Math.min(fadeIn, fadeOut);
}

/** «−10 dB». */
export function volumeLabel(db: number): string {
  return `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(Math.round(db))} dB`;
}

/** «2:14» per la durata di un brano. */
export function trackLabel(track: MusicTrack): string {
  const total = Math.round(track.durationMs / 1000);
  return `${track.fileName.replace(/\.[^.]+$/, '')} · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Traccia «Musica» della timeline: «lofi · −10 dB · si abbassa quando parli». */
export function musicTrackLabel(music: VideoMusic): string {
  const name = music.fileName.replace(/\.[^.]+$/, '');
  return `${name} · ${volumeLabel(music.volumeDb)}${music.ducking ? ' · si abbassa quando parli' : ''}`;
}

/** Il brano scelto non c'è più nella cartella (spostato, cartella cambiata). */
export function missingTrack(audio: VideoAudio, tracks: readonly MusicTrack[]): boolean {
  return audio.music !== null && !tracks.some((t) => t.path === audio.music!.path);
}

/** Brano scelto dal menu: tiene volume e ducking se c'era già musica; '' = nessuna. */
export function selectTrack(
  audio: VideoAudio,
  tracks: readonly MusicTrack[],
  path: string,
): VideoAudio {
  const track = tracks.find((t) => t.path === path);
  if (!track) return { ...audio, music: null };
  return { ...audio, music: audio.music ? { ...audio.music, ...track } : musicFromTrack(track) };
}

/** Riga di stato sotto il titolo del pannello. */
export function audioSummary(audio: VideoAudio): string {
  const parts = [
    audio.clean ? 'voce ripulita' : null,
    audio.normalize
      ? `volume a ${volumeLabel(AUDIO_LIMITS.targetLufs).replace(' dB', '')} LUFS`
      : null,
    audio.music ? `musica ${volumeLabel(audio.music.volumeDb)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'audio originale';
}
