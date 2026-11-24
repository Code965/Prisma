import type { CropRect, TimeRange } from '@prisma-app/shared';

/**
 * Grafo dei filtri FFmpeg per il video finale: per ogni parte rimasta `trim`/`atrim` con i tempi
 * azzerati, ritaglio (con lo zoom della parte) e scala alle dimensioni del formato, poi `concat`
 * e sottotitoli. Va in un
 * file letto con `-/filter_complex` (FFmpeg ≥ 7): con centinaia di tagli la riga di comando di
 * Windows sarebbe troppo lunga. I nomi dei file sono relativi alla cartella di lavoro, così
 * percorsi con «:» e «\» non vanno mai protetti dentro il grafo.
 */

const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** Dimensione pari (yuv420p non accetta dispari). */
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/**
 * Riquadro di una parte con zoom: il ritaglio del formato rimpicciolito di `scale`, centrato.
 * Poi la scala lo riporta alle dimensioni del video: l'effetto è un ingrandimento («punch-in»).
 */
export function zoomedCrop(crop: CropRect, scale: number): CropRect {
  if (scale <= 1) return crop;
  const width = even(crop.width / scale);
  const height = even(crop.height / scale);
  return {
    x: crop.x + Math.round((crop.width - width) / 2),
    y: crop.y + Math.round((crop.height - height) / 2),
    width,
    height,
  };
}

export function buildFilterGraph(options: {
  /** Parti rimaste, in ordine, ciascuna con il suo zoom (`zoomedParts`). */
  parts: ReadonlyArray<TimeRange & { scale: number }>;
  crop: CropRect;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Nome del file .ass nella cartella di lavoro; null senza sottotitoli. */
  subtitles: string | null;
}): string {
  const { parts: ranges, crop, width, height, hasAudio } = options;
  if (ranges.length === 0) {
    throw new Error('Non resta nulla da esportare: tutto il video è tagliato');
  }
  const parts: string[] = [];
  const inputs: string[] = [];
  ranges.forEach((range, i) => {
    // Ogni parte si ritaglia (con il suo zoom) e si porta alle dimensioni finali prima di
    // unirle: concat vuole parti tutte uguali.
    const box = zoomedCrop(crop, range.scale);
    parts.push(
      `[0:v]trim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},setpts=PTS-STARTPTS,` +
        `crop=w=${box.width}:h=${box.height}:x=${box.x}:y=${box.y},` +
        `scale=${width}:${height}:flags=lanczos,setsar=1[v${i}]`,
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
    `${inputs.join('')}concat=n=${ranges.length}:v=1:a=${audio}[vc]${hasAudio ? '[aout]' : ''}`,
  );
  const video = options.subtitles ? `subtitles=filename=${options.subtitles}` : 'null';
  parts.push(`[vc]${video}[vout]`);
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
