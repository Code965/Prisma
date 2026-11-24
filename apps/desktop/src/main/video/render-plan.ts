import { AUDIO_LIMITS, type CropRect, type TimeRange } from '@prisma-app/shared';

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
  /** Voce ripulita, volume uniforme e musica (6b); assente = audio montato così com'è. */
  audio?: MixOptions;
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
  const mix = options.audio ? audioMix(options.audio, hasAudio, editedMs(ranges)) : [];
  // Con l'audio da lavorare la voce montata esce come [voce]; altrimenti è già [aout].
  const voiceLabel = mix.length > 0 ? '[voce]' : '[aout]';
  parts.push(
    `${inputs.join('')}concat=n=${ranges.length}:v=1:a=${audio}[vc]${hasAudio ? voiceLabel : ''}`,
  );
  parts.push(...mix);
  const video = options.subtitles ? `subtitles=filename=${options.subtitles}` : 'null';
  parts.push(`[vc]${video}[vout]`);
  return `${parts.join(';\n')}\n`;
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

/** Argomenti di FFmpeg: H.264 + AAC in MP4 con `faststart` (si riproduce mentre si scarica). */
export function ffmpegRenderArgs(options: {
  source: string;
  graphFile: string;
  output: string;
  hasAudio: boolean;
  /** Brano della musica (ingresso 1, ripetuto se più corto del video). */
  music?: string | null;
}): string[] {
  const withAudio = options.hasAudio || Boolean(options.music);
  return [
    '-y',
    '-nostdin',
    '-i',
    options.source,
    ...(options.music ? ['-stream_loop', '-1', '-i', options.music] : []),
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
