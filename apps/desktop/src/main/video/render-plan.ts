import type { CropRect, TimeRange } from '@prisma-app/shared';

/**
 * Grafo dei filtri FFmpeg per il video finale: per ogni parte rimasta `trim`/`atrim` con i tempi
 * azzerati, poi `concat`, ritaglio, scala alle dimensioni del formato e sottotitoli. Va in un
 * file letto con `-/filter_complex` (FFmpeg ≥ 7): con centinaia di tagli la riga di comando di
 * Windows sarebbe troppo lunga. I nomi dei file sono relativi alla cartella di lavoro, così
 * percorsi con «:» e «\» non vanno mai protetti dentro il grafo.
 */

const seconds = (ms: number) => (ms / 1000).toFixed(3);

export function buildFilterGraph(options: {
  kept: readonly TimeRange[];
  crop: CropRect;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Nome del file .ass nella cartella di lavoro; null senza sottotitoli. */
  subtitles: string | null;
}): string {
  const { kept, crop, width, height, hasAudio } = options;
  if (kept.length === 0) throw new Error('Non resta nulla da esportare: tutto il video è tagliato');
  const parts: string[] = [];
  const inputs: string[] = [];
  kept.forEach((range, i) => {
    parts.push(
      `[0:v]trim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},setpts=PTS-STARTPTS[v${i}]`,
    );
    inputs.push(`[v${i}]`);
    if (hasAudio) {
      parts.push(
        `[0:a]atrim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},asetpts=PTS-STARTPTS[a${i}]`,
      );
      inputs.push(`[a${i}]`);
    }
  });
  const audio = hasAudio ? 1 : 0;
  parts.push(
    `${inputs.join('')}concat=n=${kept.length}:v=1:a=${audio}[vc]${hasAudio ? '[aout]' : ''}`,
  );
  const video = [
    `crop=w=${crop.width}:h=${crop.height}:x=${crop.x}:y=${crop.y}`,
    `scale=${width}:${height}:flags=lanczos`,
    'setsar=1',
    ...(options.subtitles ? [`subtitles=filename=${options.subtitles}`] : []),
  ];
  parts.push(`[vc]${video.join(',')}[vout]`);
  return `${parts.join(';\n')}\n`;
}

/** Argomenti di FFmpeg: H.264 + AAC in MP4 con `faststart` (si riproduce mentre si scarica). */
export function ffmpegRenderArgs(options: {
  source: string;
  graphFile: string;
  output: string;
  hasAudio: boolean;
}): string[] {
  return [
    '-y',
    '-nostdin',
    '-i',
    options.source,
    '-/filter_complex',
    options.graphFile,
    '-map',
    '[vout]',
    ...(options.hasAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '160k'] : []),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    options.output,
  ];
}
