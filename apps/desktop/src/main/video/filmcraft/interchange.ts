import {
  VIDEO_FORMAT_INFO,
  buildCaptions,
  cropRect,
  followOffsetAt,
  followPath,
  zoomedCrop,
  zoomedParts,
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
 * Parti del sorgente che diventano clip in FilmCraft: quelle rimaste dopo i tagli, divise dove
 * cambia lo zoom (6a), così ogni clip ha il suo ingrandimento. Le parti di zero fotogrammi no.
 */
export function otioParts(
  project: Pick<VideoProject, 'source' | 'edit'>,
): Array<{ startMs: number; endMs: number; scale: number }> {
  const { source, edit } = project;
  const rate = source.fps;
  return zoomedParts(keptRanges(edit.cuts, source.durationMs), edit.zooms).filter(
    (part) => msToFrames(part.endMs, rate) - msToFrames(part.startMs, rate) > 0,
  );
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
  const parts = otioParts(project).map((part) => {
    const start = msToFrames(part.startMs, rate);
    return { start, frames: msToFrames(part.endMs, rate) - start };
  });
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
  project: Pick<VideoProject, 'source' | 'edit'> & Partial<Pick<VideoProject, 'faces'>>,
  clipIds: readonly number[],
  captions: { path: string; language: string } | null,
): FilmcraftCommand[] {
  const { source, edit } = project;
  const { width, height } = VIDEO_FORMAT_INFO[edit.format];
  const parts = otioParts(project);
  // «Segui il volto» (6e): in FilmCraft ogni clip resta ferma dove il percorso la vuole a metà clip.
  const path =
    edit.followFace && project.faces
      ? followPath(project.faces, edit.format, source.width, source.height, edit.cropOffset)
      : [];
  const commands: FilmcraftCommand[] = [
    { id: 'sequence.settings', params: { width, height, fps: source.fps } },
  ];
  clipIds.forEach((clip, index) => {
    const part = parts[index];
    const offset = part
      ? followOffsetAt(path, (part.startMs + part.endMs) / 2, edit.cropOffset)
      : edit.cropOffset;
    // Il riquadro (ristretto dallo zoom, 6a) riempie la sequenza e il suo centro va al centro.
    const crop = zoomedCrop(
      cropRect(edit.format, source.width, source.height, offset),
      part?.scale ?? 1,
    );
    const scale = width / crop.width;
    const position = [
      round2(width / 2 + (source.width / 2 - (crop.x + crop.width / 2)) * scale),
      round2(height / 2 + (source.height / 2 - (crop.y + crop.height / 2)) * scale),
    ];
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
  });
  if (captions) {
    commands.push({
      id: 'captions.import',
      params: { path: captions.path, name: 'Sottotitoli', language: captions.language },
    });
  }
  return commands;
}

/** Livello sopra il video per FilmCraft: file già importato (id) e tempi sul video montato. */
export interface PlacedLayer {
  item: number;
  kind: 'broll-video' | 'broll-image' | 'card';
  startS: number;
  endS: number;
}

/**
 * Schede, B-roll e audio lavorato in FilmCraft (verificato con FilmCraft 0.20.1): due tracce video
 * in più (B-roll su V2, schede su V3) e una audio (A2) con l'audio di Prisma, mentre A1 (l'audio
 * originale) si spegne. `timeline.place` vuole l'istante come `seconds` al primo livello.
 */
export function placeCommands(
  layers: readonly PlacedLayer[],
  audioItem: number | null,
): FilmcraftCommand[] {
  const commands: FilmcraftCommand[] = [];
  if (layers.length > 0 || audioItem !== null) {
    commands.push({
      id: 'sequence.addTracks',
      params: { video: layers.length > 0 ? 2 : 0, audio: audioItem !== null ? 1 : 0 },
    });
  }
  for (const layer of layers) {
    commands.push({
      id: 'timeline.place',
      params: {
        item: layer.item,
        track: layer.kind === 'card' ? 'V3' : 'V2',
        seconds: round2(layer.startS),
        duration: { seconds: round2(layer.endS - layer.startS) },
        audio: false,
      },
    });
  }
  if (audioItem !== null) {
    commands.push(
      { id: 'timeline.place', params: { item: audioItem, track: 'A2', seconds: 0, video: false } },
      { id: 'timeline.setTrack', params: { track: 'A1', muted: true } },
    );
  }
  return commands;
}

/** Id delle clip create da `run` (una riga JSON per comando, `result.clips`). */
export function placedClipIds(output: string): number[][] {
  return output
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      const parsed = JSON.parse(line) as {
        id?: string;
        ok?: boolean;
        error?: string;
        result?: { clips?: number[] };
      };
      if (parsed.ok === false) throw new Error(`FilmCraft: ${parsed.error ?? parsed.id}`);
      return parsed.id === 'timeline.place' ? (parsed.result?.clips ?? []) : null;
    })
    .filter((clips): clips is number[] => clips !== null);
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
