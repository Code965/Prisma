import {
  VIDEO_FORMAT_INFO,
  buildCaptions,
  cropRect,
  editedTimeMs,
  keptRanges,
  type VideoProject,
} from '@prisma-app/shared';
import { pathToFileURL } from 'node:url';

/**
 * Passaggio a FilmCraft (passo 3e): le modifiche di Prisma diventano un OpenTimelineIO con le
 * parti rimaste, un SRT con i sottotitoli e i comandi che impostano formato e ritaglio. Comandi
 * e parametri verificati con `filmcraft-cli commands` di FilmCraft 0.20.1 (novembre 2026).
 */

interface RationalTime {
  OTIO_SCHEMA: 'RationalTime.1';
  rate: number;
  value: number;
}

function rationalTime(frames: number, rate: number): RationalTime {
  return { OTIO_SCHEMA: 'RationalTime.1', rate, value: frames };
}

function timeRange(startFrames: number, durationFrames: number, rate: number) {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: rationalTime(startFrames, rate),
    duration: rationalTime(durationFrames, rate),
  };
}

/** Millisecondi → fotogrammi interi del sorgente (i tagli cadono sul fotogramma più vicino). */
export function msToFrames(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

/**
 * Timeline OTIO: una traccia video e, se c'è, una audio, con una clip per ogni parte rimasta del
 * sorgente. Il file sorgente è un riferimento esterno (`file:///…`): FilmCraft lo collega senza
 * copiarlo.
 */
export function buildOtio(project: Pick<VideoProject, 'title' | 'source' | 'edit'>) {
  const { source, edit } = project;
  const rate = source.fps;
  const totalFrames = msToFrames(source.durationMs, rate);
  const parts = keptRanges(edit.cuts, source.durationMs)
    .map((range) => {
      const start = msToFrames(range.startMs, rate);
      return { start, frames: msToFrames(range.endMs, rate) - start };
    })
    .filter((part) => part.frames > 0);
  const reference = {
    OTIO_SCHEMA: 'ExternalReference.1',
    name: source.fileName,
    target_url: pathToFileURL(source.path).href,
    available_range: timeRange(0, totalFrames, rate),
    metadata: {},
  };
  const clips = parts.map((part, index) => ({
    OTIO_SCHEMA: 'Clip.2',
    name: `Parte ${index + 1}`,
    metadata: {},
    source_range: timeRange(part.start, part.frames, rate),
    effects: [],
    markers: [],
    enabled: true,
    media_references: { DEFAULT_MEDIA: reference },
    active_media_reference_key: 'DEFAULT_MEDIA',
  }));
  const track = (kind: 'Video' | 'Audio', name: string) => ({
    OTIO_SCHEMA: 'Track.1',
    name,
    kind,
    metadata: {},
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children: clips,
  });
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: project.title,
    metadata: { prisma: { format: edit.format, cropOffset: edit.cropOffset } },
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      metadata: {},
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      children: source.hasAudio
        ? [track('Video', 'V1'), track('Audio', 'A1')]
        : [track('Video', 'V1')],
    },
  };
}

/** «00:01:02,345» */
export function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(hours)}:${two(minutes)}:${two(seconds)},${String(millis).padStart(3, '0')}`;
}

/**
 * Sottotitoli SRT sui tempi del video montato, una riga per didascalia. FilmCraft li disegna con
 * il proprio stile (riquadro scuro): lo stile «parola per parola» resta del render di Prisma.
 * Null senza trascrizione o senza parole rimaste.
 */
export function buildSrt(project: Pick<VideoProject, 'transcript' | 'edit'>): string | null {
  if (!project.transcript) return null;
  const { cuts } = project.edit;
  const captions = buildCaptions(project.transcript.words, cuts);
  if (captions.length === 0) return null;
  return (
    captions
      .map((caption, index) => {
        const start = editedTimeMs(cuts, caption.startMs);
        const end = Math.max(editedTimeMs(cuts, caption.endMs), start + 1);
        const text = caption.words.map((w) => w.text).join(' ');
        return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`;
      })
      .join('\n') + '\n'
  );
}

/** Un comando di `filmcraft-cli run`: una riga JSON `{id, params}`. */
export interface FilmcraftCommand {
  id: string;
  params: Record<string, unknown>;
}

/**
 * Comandi dopo l'import dell'OTIO: dimensioni della sequenza del formato scelto, poi per ogni
 * clip scala e posizione (Motion, in pixel della sequenza) che riproducono il ritaglio di
 * Prisma, infine i sottotitoli.
 */
export function setupCommands(
  project: Pick<VideoProject, 'source' | 'edit'>,
  clipIds: readonly number[],
  captions: { path: string; language: string } | null,
): FilmcraftCommand[] {
  const { source, edit } = project;
  const { width, height } = VIDEO_FORMAT_INFO[edit.format];
  const crop = cropRect(edit.format, source.width, source.height, edit.cropOffset);
  const scale = width / crop.width;
  // Il centro del riquadro di ritaglio deve finire al centro della sequenza.
  const position = [
    round2(width / 2 + (source.width / 2 - (crop.x + crop.width / 2)) * scale),
    round2(height / 2 + (source.height / 2 - (crop.y + crop.height / 2)) * scale),
  ];
  const commands: FilmcraftCommand[] = [
    { id: 'sequence.settings', params: { width, height, fps: source.fps } },
  ];
  for (const clip of clipIds) {
    commands.push(
      {
        id: 'effects.setParam',
        params: { clip, effect: 'motion', param: 'scale', value: round2(scale * 100) },
      },
      {
        id: 'effects.setParam',
        params: { clip, effect: 'motion', param: 'position', value: position },
      },
    );
  }
  if (captions) {
    commands.push({
      id: 'captions.import',
      params: { path: captions.path, name: 'Sottotitoli', language: captions.language },
    });
  }
  return commands;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Id delle clip video della sequenza attiva, dall'output di `filmcraft-cli inspect sequence`. */
export function videoClipIds(inspect: unknown): number[] {
  const root = inspect as { sequence?: unknown };
  const sequence = (root.sequence ?? inspect) as {
    video?: Array<{ items?: Array<{ clip?: unknown }> }>;
  };
  return (sequence.video ?? []).flatMap((track) =>
    (track.items ?? []).flatMap((item) => (typeof item.clip === 'number' ? [item.clip] : [])),
  );
}
