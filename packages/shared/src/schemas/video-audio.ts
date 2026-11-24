import { z } from 'zod';

/**
 * Audio del video (fase 6b): voce ripulita, volume uniforme e musica da una cartella
 * dell'utente, che si abbassa da sola mentre si parla («ducking»). Il sorgente non cambia: il
 * render applica queste scelte con FFmpeg.
 */

export const AUDIO_LIMITS = {
  /** Volume della voce dopo la normalizzazione (LUFS): il livello a cui YouTube, Instagram e TikTok portano i video. */
  targetLufs: -14,
  musicVolumeMinDb: -30,
  musicVolumeMaxDb: 0,
  /** Musica rispetto alla voce, quando non si parla. */
  defaultMusicVolumeDb: -10,
  /** Quanto scende ancora la musica mentre si parla. */
  duckingDb: 12,
  fadeInMs: 1000,
  fadeOutMs: 2000,
} as const;

/** Estensioni dei brani letti dalla cartella della musica. */
export const MUSIC_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] as const;

export const MusicTrackSchema = z.object({
  path: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(260),
  durationMs: z.int().positive(),
});
export type MusicTrack = z.infer<typeof MusicTrackSchema>;

export const VideoMusicSchema = MusicTrackSchema.extend({
  volumeDb: z
    .number()
    .min(AUDIO_LIMITS.musicVolumeMinDb)
    .max(AUDIO_LIMITS.musicVolumeMaxDb)
    .default(AUDIO_LIMITS.defaultMusicVolumeDb),
  ducking: z.boolean().default(true),
});
export type VideoMusic = z.infer<typeof VideoMusicSchema>;

export const VideoAudioSchema = z.object({
  /** Taglia il rombo sotto 80 Hz e riduce il rumore di fondo costante (ventola, ronzio, fruscio). */
  clean: z.boolean(),
  /** Compressione leggera e volume a −14 LUFS. */
  normalize: z.boolean(),
  music: VideoMusicSchema.nullable(),
});
export type VideoAudio = z.infer<typeof VideoAudioSchema>;

/** Progetti salvati prima della 6b: l'audio resta com'era (e il render non risulta superato). */
export const LEGACY_VIDEO_AUDIO: VideoAudio = { clean: false, normalize: false, music: null };

/** Progetti nuovi: voce ripulita e volume uniforme, musica a scelta. */
export const DEFAULT_VIDEO_AUDIO: VideoAudio = { clean: true, normalize: true, music: null };

export function isLegacyAudio(audio: VideoAudio): boolean {
  return !audio.clean && !audio.normalize && audio.music === null;
}

export function musicFromTrack(track: MusicTrack): VideoMusic {
  return {
    ...track,
    volumeDb: AUDIO_LIMITS.defaultMusicVolumeDb,
    ducking: true,
  };
}

/** Un brano a caso (per «Crea video»): `random` in [0, 1). */
export function pickTrack(tracks: readonly MusicTrack[], random: number): MusicTrack | null {
  if (tracks.length === 0) return null;
  return tracks[Math.min(tracks.length - 1, Math.floor(random * tracks.length))]!;
}

/** Volume lineare per l'anteprima nel browser: −10 dB → 0,316. */
export function dbToGain(db: number): number {
  return Math.min(1, Math.max(0, 10 ** (db / 20)));
}
