import {
  AUDIO_LIMITS,
  followSegment,
  zoomedCrop,
  type Box,
  type CropRect,
  type FollowPoint,
  type TimeRange,
} from '@prisma-app/shared';

/**
 * Grafo dei filtri FFmpeg per il video finale: per ogni parte rimasta `trim`/`atrim` con i tempi
 * azzerati, ritaglio (con lo zoom della parte) e scala alle dimensioni del formato, poi `concat`
 * e sottotitoli. Va in un
 * file letto con `-/filter_complex` (FFmpeg ≥ 7): con centinaia di tagli la riga di comando di
 * Windows sarebbe troppo lunga. I nomi dei file sono relativi alla cartella di lavoro, così
 * percorsi con «:» e «\» non vanno mai protetti dentro il grafo.
 */

const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** Riquadro con lo zoom (in shared: lo usa anche l'anteprima del layout). */
export { zoomedCrop };

export function buildFilterGraph(options: {
  /** Parti rimaste, in ordine, ciascuna con il suo zoom (`zoomedParts`). */
  parts: ReadonlyArray<TimeRange & { scale: number }>;
  crop: CropRect;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Nome del file .ass nella cartella di lavoro; null senza sottotitoli. */
  subtitles: string | null;
  /** Voce ripulita, volume uniforme e musica (6b); assente = audio montato così com'è. */
  audio?: MixOptions;
  /** B-roll e schede sopra il video montato (6d), nell'ordine in cui si sovrappongono. */
  layers?: readonly VideoLayer[];
  /** Indice del primo ingresso dei livelli (dopo il sorgente e l'eventuale musica). */
  firstLayerInput?: number;
  /** Il ritaglio segue il volto (6e): percorso della posizione e corsa in pixel sull'asse libero. */
  follow?: CropFollow | null;
  /**
   * Layout con lo schermo registrato (6f): riquadri della webcam e dello schermo nel video finale
   * e ingresso dello schermo. Assente = solo la webcam a tutto schermo, come prima.
   */
  composition?: Composition | null;
}): string {
  const { parts: ranges, crop, width, height, hasAudio } = options;
  if (ranges.length === 0) {
    throw new Error('Non resta nulla da esportare: tutto il video è tagliato');
  }
  const parts: string[] = [];
  const inputs: string[] = [];
  const composition = options.composition ?? null;
  // La webcam riempie il suo riquadro del layout (tutto il video senza schermo).
  const composed = isComposed(composition);
  const cameraSize = (composed && composition?.camera) || { width, height };
  ranges.forEach((range, i) => {
    // Ogni parte si ritaglia (con il suo zoom) e si porta alle dimensioni finali prima di
    // unirle: concat vuole parti tutte uguali.
    const box = zoomedCrop(crop, range.scale);
    const position = options.follow
      ? followCropPosition(options.follow, crop, box, range)
      : { x: String(box.x), y: String(box.y) };
    parts.push(
      `[0:v]trim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},setpts=PTS-STARTPTS,` +
        `crop=w=${box.width}:h=${box.height}:x=${position.x}:y=${position.y},` +
        `scale=${cameraSize.width}:${cameraSize.height}:flags=lanczos,setsar=1[v${i}]`,
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
  const mix = options.audio ? audioMix(options.audio, hasAudio, editedMs(ranges)) : [];
  // Con l'audio da lavorare la voce montata esce come [voce]; altrimenti è già [aout].
  const voiceLabel = mix.length > 0 ? '[voce]' : '[aout]';
  parts.push(
    `${inputs.join('')}concat=n=${ranges.length}:v=1:a=${audio}[${composed ? 'vcam' : 'vc'}]${hasAudio ? voiceLabel : ''}`,
  );
  parts.push(...mix);
  parts.push(...composeLayout(composition, ranges));
  let current = 'vc';
  (options.layers ?? []).forEach((layer, i) => {
    const input = (options.firstLayerInput ?? 1) + i;
    parts.push(`[${input}:v]${layerChain(layer, width, height)}[l${i}]`);
    parts.push(
      `[${current}][l${i}]overlay=0:0:eof_action=pass:enable='between(t,${layer.startS.toFixed(3)},${layer.endS.toFixed(3)})'[o${i}]`,
    );
    current = `o${i}`;
  });
  const video = options.subtitles ? `subtitles=filename=${options.subtitles}` : 'null';
  parts.push(`[${current}]${video}[vout]`);
  return `${parts.join(';\n')}\n`;
}

/** Webcam e schermo nel video finale (6f). */
export interface Composition {
  layout: 'camera' | 'screen' | 'pip' | 'split';
  /** Riquadro della webcam; null = non si vede (solo schermo, resta la voce). */
  camera: Box | null;
  screen: Box | null;
  /** Ingresso dello schermo e sincronia con la webcam. */
  screenInput: number;
  offsetMs: number;
  screenDurationMs: number;
  /** Colore delle bande attorno allo schermo, che entra intero (`0xRRGGBB`). */
  background: string;
}

/** C'è davvero da comporre (layout con lo schermo). */
export function isComposed(composition: Composition | null): composition is Composition {
  return Boolean(composition && composition.layout !== 'camera' && composition.screen);
}

/**
 * Lo schermo segue gli stessi tagli della webcam (spostati di `offsetMs`): ogni parte dura
 * esattamente come quella della webcam (`tpad` ripete il primo o l'ultimo fotogramma se lo
 * schermo è partito dopo o finito prima) e lo schermo entra intero nel suo riquadro, con le
 * bande del colore di fondo. Poi webcam e schermo si compongono in `[vc]`.
 */
export function composeLayout(
  composition: Composition | null,
  ranges: readonly TimeRange[],
): string[] {
  if (!isComposed(composition)) return [];
  const screen = composition.screen!;
  const parts: string[] = [];
  const end = composition.screenDurationMs / 1000;
  ranges.forEach((range, i) => {
    const length = (range.endMs - range.startMs) / 1000;
    const from = (range.startMs - composition.offsetMs) / 1000;
    const start = Math.min(Math.max(0, from), Math.max(0, end - 0.05));
    const stop = Math.max(start + 0.05, Math.min(end, from + length));
    const padStart = Math.max(0, start - from);
    parts.push(
      `[${composition.screenInput}:v]trim=start=${start.toFixed(3)}:end=${stop.toFixed(3)},setpts=PTS-STARTPTS,fps=30,` +
        `tpad=start_mode=clone:start_duration=${padStart.toFixed(3)}:stop_mode=clone:stop_duration=${length.toFixed(3)},` +
        `trim=duration=${length.toFixed(3)},setpts=PTS-STARTPTS,` +
        `scale=${screen.width}:${screen.height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${screen.width}:${screen.height}:(ow-iw)/2:(oh-ih)/2:color=${composition.background},setsar=1[s${i}]`,
    );
  });
  parts.push(`${ranges.map((_, i) => `[s${i}]`).join('')}concat=n=${ranges.length}:v=1:a=0[vscr]`);
  switch (composition.layout) {
    case 'screen':
      parts.push('[vscr]null[vc]', '[vcam]nullsink');
      break;
    case 'pip':
      parts.push(`[vscr][vcam]overlay=x=${composition.camera!.x}:y=${composition.camera!.y}[vc]`);
      break;
    case 'split':
      parts.push('[vscr][vcam]vstack=inputs=2[vc]');
      break;
  }
  return parts;
}

/** Ritaglio che segue il volto: percorso (istanti del sorgente) e asse su cui si sposta. */
export interface CropFollow {
  path: readonly FollowPoint[];
  /** Posizione quando il percorso non dice nulla (quella scelta a mano). */
  fallback: number;
  axis: 'x' | 'y';
  /** Corsa del ritaglio intero in pixel: sorgente meno ritaglio sull'asse libero. */
  travel: number;
}

/**
 * Posizione del ritaglio di una parte come espressione di `t` (secondi dall'inizio della parte,
 * dopo `setpts=PTS-STARTPTS`): interpolazione lineare tra i punti del percorso, più lo
 * spostamento verso il centro dello zoom. Tra apici: le virgole restano dentro l'opzione.
 */
export function followCropPosition(
  follow: CropFollow,
  crop: CropRect,
  box: CropRect,
  range: TimeRange,
): { x: string; y: string } {
  const points = followSegment(follow.path, range.startMs, range.endMs, follow.fallback);
  const shift = follow.axis === 'x' ? (crop.width - box.width) / 2 : (crop.height - box.height) / 2;
  const at = (offset: number) => (shift + offset * follow.travel).toFixed(1);
  let expr = at(points[points.length - 1]!.offset);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const t0 = (a.ms - range.startMs) / 1000;
    const t1 = (b.ms - range.startMs) / 1000;
    const slope = t1 > t0 ? ((b.offset - a.offset) * follow.travel) / (t1 - t0) : 0;
    const segment = `${at(a.offset)}+(t-${t0.toFixed(3)})*${slope.toFixed(3)}`;
    expr = `if(lt(t,${t1.toFixed(3)}),${segment},${expr})`;
  }
  const moving = `'${expr}'`;
  return follow.axis === 'x' ? { x: moving, y: String(box.y) } : { x: String(box.x), y: moving };
}

const editedMs = (ranges: readonly TimeRange[]) =>
  ranges.reduce((total, r) => total + (r.endMs - r.startMs), 0);

/** Musica pronta per il grafo: è l'ingresso 1 (`-stream_loop -1`, si ripete se è corta). */
export interface MixMusic {
  volumeDb: number;
  ducking: boolean;
}

export interface MixOptions {
  clean: boolean;
  normalize: boolean;
  music: MixMusic | null;
  /**
   * Guadagno della voce misurato prima (`loudnessGraph`): −14 LUFS meno il volume misurato.
   * Un guadagno fisso non alza le pause come `loudnorm` in tempo reale, che riporterebbe su il
   * rumore appena tolto. Assente = `loudnorm` dinamico.
   */
  voiceGainDb?: number | null;
  /**
   * Correzione del mix finale con la musica (seconda misura, `mixLoudnessGraph`): le pause con
   * la musica contano nella misura del volume e lo abbassano.
   */
  mixGainDb?: number | null;
}

/**
 * Gate morbido sulle pause: con la voce già a −14 LUFS, sotto −28 dBFS il rumore rimasto scende
 * fino a 15 dB (rapporto 4, mai muto); attacco e rilascio lenti non mangiano le fini delle parole.
 * `afftdn` da solo toglie pochi dB a un rumore largo come quello di una ventola.
 */
const PAUSE_GATE = 'agate=threshold=0.04:ratio=4:range=0.18:knee=1.5:attack=10:release=300';

/** Ripulitura e compressione della voce, comuni a misura e render. */
function voiceChain(audio: MixOptions): string[] {
  const chain: string[] = [];
  if (audio.clean) chain.push('highpass=f=80', 'afftdn=nr=20:nf=-45:tn=1');
  if (audio.normalize) {
    chain.push('acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2');
  }
  return chain;
}

/**
 * Grafo della misura del volume (primo passaggio, solo audio): parti rimaste, ripulitura e
 * compressione come nel render, poi `loudnorm` che stampa le misure in JSON.
 */
export function loudnessGraph(parts: readonly TimeRange[], audio: MixOptions): string {
  const lines = parts.map(
    (range, i) =>
      `[0:a]atrim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},asetpts=PTS-STARTPTS[a${i}]`,
  );
  const inputs = parts.map((_, i) => `[a${i}]`).join('');
  const chain = [
    ...voiceChain(audio),
    `loudnorm=I=${AUDIO_LIMITS.targetLufs}:TP=-1.5:LRA=11:print_format=json`,
  ];
  lines.push(`${inputs}concat=n=${parts.length}:v=0:a=1,${chain.join(',')}[aout]`);
  return `${lines.join(';\n')}\n`;
}

/**
 * Seconda misura, solo con la musica e il volume uniforme: tutto l'audio del render (voce col
 * suo guadagno e musica), poi `loudnorm` che stampa il volume del mix.
 */
export function mixLoudnessGraph(
  parts: readonly TimeRange[],
  hasAudio: boolean,
  audio: MixOptions,
): string {
  const lines: string[] = [];
  if (hasAudio) {
    parts.forEach((range, i) =>
      lines.push(
        `[0:a]atrim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},asetpts=PTS-STARTPTS[a${i}]`,
      ),
    );
    lines.push(`${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[voce]`);
  }
  lines.push(...audioMix({ ...audio, mixGainDb: null }, hasAudio, editedMs(parts)));
  lines.push(
    `[aout]loudnorm=I=${AUDIO_LIMITS.targetLufs}:TP=-1.5:LRA=11:print_format=json[misura]`,
  );
  return `${lines.join(';\n')}\n`;
}

export function mixLoudnessArgs(source: string, music: string, graphFile: string): string[] {
  return [
    '-y',
    '-nostdin',
    '-i',
    source,
    '-stream_loop',
    '-1',
    '-i',
    music,
    '-/filter_complex',
    graphFile,
    '-map',
    '[misura]',
    '-f',
    'null',
    '-',
  ];
}

export function loudnessArgs(source: string, graphFile: string): string[] {
  return [
    '-y',
    '-nostdin',
    '-i',
    source,
    '-/filter_complex',
    graphFile,
    '-map',
    '[aout]',
    '-f',
    'null',
    '-',
  ];
}

/**
 * Guadagno per arrivare a −14 LUFS dal JSON stampato da `loudnorm` (`input_i`); null se manca o
 * se l'audio è silenzio (−inf). Limitato a ±30 dB.
 */
export function voiceGainFromLoudnorm(output: string): number | null {
  const match = /"input_i"\s*:\s*"(-?[\d.]+|-inf)"/.exec(output);
  if (!match || match[1] === '-inf') return null;
  const measured = Number(match[1]);
  if (!Number.isFinite(measured)) return null;
  const gain = AUDIO_LIMITS.targetLufs - measured;
  return Math.max(-30, Math.min(30, Math.round(gain * 10) / 10));
}

/** Serve lavorare l'audio (altrimenti la voce montata va dritta nel file). */
export function needsMix(audio: MixOptions, hasAudio: boolean): boolean {
  return audio.music !== null || (hasAudio && (audio.clean || audio.normalize));
}

/**
 * Catena dell'audio dopo il montaggio, da `[voce]` (se il video ha audio) a `[aout]`:
 * - voce ripulita: passa-alto a 80 Hz (rombo, colpi al microfono), `afftdn` con stima continua
 *   del rumore (ventola, ronzio, fruscio) e un gate morbido sulle pause;
 * - volume uniforme: compressione leggera e guadagno fisso fino a −14 LUFS, misurato prima
 *   (`loudnessGraph`), con un limitatore a −1,5 dB per i picchi;
 * - musica: alla durata del video, stesso volume di riferimento, poi il volume scelto, entrata e
 *   uscita in dissolvenza; mentre si parla scende con `sidechaincompress` comandato dalla voce;
 *   voce e musica sommate senza riscalarle, con un limitatore contro la saturazione.
 */
export function audioMix(audio: MixOptions, hasAudio: boolean, durationMs: number): string[] {
  if (!needsMix(audio, hasAudio)) return [];
  const parts: string[] = [];
  const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  if (hasAudio) {
    const chain = voiceChain(audio);
    const gain = typeof audio.voiceGainDb === 'number' ? audio.voiceGainDb : null;
    if (audio.normalize && gain !== null) {
      chain.push(`volume=${gain.toFixed(1)}dB`);
      if (audio.clean) chain.push(PAUSE_GATE);
      chain.push('alimiter=limit=0.84:level=false');
    } else if (audio.normalize) {
      chain.push(`loudnorm=I=${AUDIO_LIMITS.targetLufs}:TP=-1.5:LRA=11`);
      if (audio.clean) chain.push(PAUSE_GATE);
    } else if (audio.clean && gain !== null) {
      // Il gate lavora sul livello di riferimento, poi la voce torna al volume originale.
      chain.push(`volume=${gain.toFixed(1)}dB`, PAUSE_GATE, `volume=${(-gain).toFixed(1)}dB`);
    }
    chain.push('aresample=48000', fmt);
    parts.push(`[voce]${chain.join(',')}[vpulita]`);
  }
  if (!audio.music) {
    parts.push('[vpulita]anull[aout]');
    return parts;
  }
  const total = durationMs / 1000;
  const fadeIn = Math.min(AUDIO_LIMITS.fadeInMs / 1000, total / 4);
  const fadeOut = Math.min(AUDIO_LIMITS.fadeOutMs / 1000, total / 4);
  parts.push(
    `[1:a]atrim=duration=${total.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `loudnorm=I=${AUDIO_LIMITS.targetLufs}:TP=-1.5,aresample=48000,${fmt},` +
      `volume=${audio.music.volumeDb.toFixed(1)}dB,` +
      `afade=t=in:d=${fadeIn.toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, total - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[musica]`,
  );
  const mixGain =
    typeof audio.mixGainDb === 'number' ? `volume=${audio.mixGainDb.toFixed(1)}dB,` : '';
  const finish = `${mixGain}alimiter=limit=0.95:level=false[aout]`;
  if (!hasAudio) {
    parts.push(`[musica]${finish}`);
    return parts;
  }
  if (audio.music.ducking) {
    // Soglia bassa e rapporto 5: con la voce presente la musica scende di circa 13 dB.
    parts.push('[vpulita]asplit=2[vmix][vcomando]');
    parts.push(
      '[musica][vcomando]sidechaincompress=threshold=0.02:ratio=5:attack=30:release=500[mbassa]',
    );
    parts.push(`[vmix][mbassa]amix=inputs=2:duration=first:normalize=0,${finish}`);
  } else {
    parts.push(`[vpulita][musica]amix=inputs=2:duration=first:normalize=0,${finish}`);
  }
  return parts;
}

/**
 * Un livello sopra il video montato, con i tempi del video montato (secondi): spezzone o
 * immagine di B-roll (copre tutto il riquadro) o scheda di testo (PNG trasparente).
 */
export interface VideoLayer {
  kind: 'broll-video' | 'broll-image' | 'card';
  /** File nella cartella di lavoro (schede) o percorso assoluto (B-roll). */
  file: string;
  startS: number;
  endS: number;
}

const FPS = 30;

/** Argomenti d'ingresso di un livello: lo spezzone si ripete se è corto, immagini e schede durano quanto serve. */
export function layerInputArgs(layer: VideoLayer): string[] {
  const duration = (layer.endS - layer.startS).toFixed(3);
  return layer.kind === 'broll-video'
    ? ['-stream_loop', '-1', '-i', layer.file]
    : ['-loop', '1', '-framerate', String(FPS), '-t', duration, '-i', layer.file];
}

/**
 * Filtri del livello: lo spezzone riempie il riquadro (ritaglio al centro), l'immagine si
 * avvicina piano (ingrandita a 2× prima di `zoompan`, perché non tremi), la scheda entra ed
 * esce in dissolvenza. Tutto spostato all'istante d'inizio con `setpts`.
 */
export function layerChain(layer: VideoLayer, width: number, height: number): string {
  const duration = layer.endS - layer.startS;
  const shift = `setpts=PTS-STARTPTS+${layer.startS.toFixed(3)}/TB`;
  const fill = (w: number, h: number) =>
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
  switch (layer.kind) {
    case 'broll-video':
      return `trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},${fill(width, height)},setsar=1,format=yuv420p,${shift}`;
    case 'broll-image': {
      const frames = Math.max(1, Math.round(duration * FPS));
      const step = (0.08 / frames).toFixed(6);
      return (
        `${fill(width * 2, height * 2)},` +
        `zoompan=z='min(1+${step}*on\\,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${FPS},` +
        `setsar=1,format=yuv420p,${shift}`
      );
    }
    case 'card': {
      const fade = Math.min(0.25, duration / 4).toFixed(3);
      return (
        `format=rgba,fade=t=in:st=0:d=${fade}:alpha=1,` +
        `fade=t=out:st=${Math.max(0, duration - Number(fade)).toFixed(3)}:d=${fade}:alpha=1,${shift}`
      );
    }
  }
}

/** Argomenti di FFmpeg: H.264 + AAC in MP4 con `faststart` (si riproduce mentre si scarica). */
export function ffmpegRenderArgs(options: {
  source: string;
  graphFile: string;
  output: string;
  hasAudio: boolean;
  /** Brano della musica (ingresso 1, ripetuto se più corto del video). */
  music?: string | null;
  /** B-roll e schede, dopo sorgente e musica. */
  layers?: readonly VideoLayer[];
  /** Schermo registrato (6f): l'ultimo ingresso. */
  screen?: string | null;
}): string[] {
  const withAudio = options.hasAudio || Boolean(options.music);
  return [
    '-y',
    '-nostdin',
    '-i',
    options.source,
    ...(options.music ? ['-stream_loop', '-1', '-i', options.music] : []),
    ...(options.layers ?? []).flatMap(layerInputArgs),
    ...(options.screen ? ['-i', options.screen] : []),
    '-/filter_complex',
    options.graphFile,
    '-map',
    '[vout]',
    ...(withAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '160k'] : []),
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
