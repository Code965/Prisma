/**
 * Montaggio di «Crea video dall'idea» (fase 6c): per ogni scena la slide (JPEG 1080×1350) con uno
 * zoom lento, su un fondo verticale 1080×1920 del colore del template, e la voce della scena;
 * poi tutte le scene in fila. Un solo passaggio di FFmpeg, grafo letto da file come nel render.
 */

export const SLIDESHOW = {
  width: 1080,
  height: 1920,
  slideWidth: 1080,
  slideHeight: 1350,
  /** La slide sta un po' in alto: sotto restano i sottotitoli. */
  slideTop: 190,
  fps: 30,
  /** Pausa dopo la voce di ogni scena, prima della slide successiva. */
  pauseMs: 450,
  /** Zoom alla fine di ogni scena (parte da 1). */
  zoomTo: 1.06,
} as const;

export interface SlideshowScene {
  /** Nomi dei file nella cartella di lavoro (FFmpeg gira lì). */
  slide: string;
  voice: string;
  speechMs: number;
}

export function sceneDurationMs(speechMs: number): number {
  return speechMs + SLIDESHOW.pauseMs;
}

const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** Colore per FFmpeg: `#0f1115` → `0x0f1115`. */
export function ffmpegColor(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `0x${hex.slice(1)}` : '0x000000';
}

/**
 * Grafo dei filtri. Gli ingressi sono a coppie: slide (immagine ripetuta) e voce. La slide si
 * ingrandisce prima di `zoompan` (a 2×) perché lo zoom lento non tremi.
 */
export function slideshowGraph(scenes: readonly SlideshowScene[], background: string): string {
  const { slideWidth: w, slideHeight: h, width, height, slideTop, fps, zoomTo } = SLIDESHOW;
  const parts: string[] = [];
  const pairs: string[] = [];
  scenes.forEach((scene, i) => {
    const durationMs = sceneDurationMs(scene.speechMs);
    const frames = Math.max(1, Math.round((durationMs / 1000) * fps));
    const step = ((zoomTo - 1) / frames).toFixed(6);
    parts.push(
      `[${i * 2}:v]scale=${w * 2}:${h * 2}:flags=lanczos,` +
        `zoompan=z='min(1+${step}*on\\,${zoomTo})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=1:s=${w}x${h}:fps=${fps},` +
        `pad=${width}:${height}:0:${slideTop}:color=${ffmpegColor(background)},` +
        `setsar=1,format=yuv420p,trim=duration=${seconds(durationMs)},setpts=PTS-STARTPTS[v${i}]`,
    );
    parts.push(
      `[${i * 2 + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,` +
        `apad=whole_dur=${seconds(durationMs)},atrim=duration=${seconds(durationMs)},` +
        `asetpts=PTS-STARTPTS[a${i}]`,
    );
    pairs.push(`[v${i}][a${i}]`);
  });
  parts.push(`${pairs.join('')}concat=n=${scenes.length}:v=1:a=1[vout][aout]`);
  return `${parts.join(';\n')}\n`;
}

export function slideshowArgs(options: {
  scenes: readonly SlideshowScene[];
  graphFile: string;
  output: string;
}): string[] {
  const inputs = options.scenes.flatMap((scene) => [
    '-loop',
    '1',
    '-framerate',
    String(SLIDESHOW.fps),
    '-t',
    seconds(sceneDurationMs(scene.speechMs)),
    '-i',
    scene.slide,
    '-i',
    scene.voice,
  ]);
  return [
    '-y',
    '-nostdin',
    ...inputs,
    '-/filter_complex',
    options.graphFile,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(SLIDESHOW.fps),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    options.output,
  ];
}

/** Durata di un WAV PCM dall'intestazione (`fmt ` per i byte al secondo, `data` per la misura). */
export function wavDurationMs(wav: Buffer): number {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Il file della voce non è un WAV');
  }
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = wav.readUInt32LE(offset + 16);
    if (id === 'data') {
      if (!byteRate) break;
      // Alcuni programmi scrivono la misura prima di conoscerla: si usa ciò che c'è davvero.
      const bytes = Math.min(size, wav.length - offset - 8);
      return Math.round((bytes / byteRate) * 1000);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV senza audio leggibile');
}
