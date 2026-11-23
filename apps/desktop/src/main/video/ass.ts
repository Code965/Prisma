import { editedTimeMs, type Caption, type SubtitleStyle, type TimeRange } from '@prisma-app/shared';

/**
 * Sottotitoli in formato ASS per il filtro `subtitles` di FFmpeg (libass), con le dimensioni
 * del video finale. Font di sistema di Windows (Segoe UI): libass non legge i WOFF2 dell'app.
 * Lo stile «parola per parola» del mockup ha la parola evidenziata su fondo giallo: in ASS il
 * fondo per singola parola non si può fare, quindi la parola attiva diventa gialla.
 */

interface StyleSpec {
  /** Dimensione del testo rispetto all'altezza del video. */
  size: number;
  bold: boolean;
  /** 1 = contorno e ombra, 3 = riquadro opaco dietro il testo. */
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  /** &HAABBGGRR: per il riquadro, nero all'82% (alpha 2E). */
  back: string;
  /** Distanza dal basso rispetto all'altezza. */
  marginV: number;
  uppercase: boolean;
}

const STYLES: Record<SubtitleStyle, StyleSpec> = {
  clean: {
    size: 0.034,
    bold: true,
    borderStyle: 1,
    outline: 0.0015,
    shadow: 0.002,
    back: '&H80000000',
    marginV: 0.09,
    uppercase: false,
  },
  word: {
    size: 0.04,
    bold: true,
    borderStyle: 1,
    outline: 0.002,
    shadow: 0.002,
    back: '&H80000000',
    marginV: 0.09,
    uppercase: false,
  },
  box: {
    size: 0.032,
    bold: true,
    borderStyle: 3,
    outline: 0.006,
    shadow: 0,
    back: '&H2E000000',
    marginV: 0.09,
    uppercase: false,
  },
  big: {
    size: 0.065,
    bold: true,
    borderStyle: 1,
    outline: 0.0025,
    shadow: 0.003,
    back: '&H80000000',
    marginV: 0.3,
    uppercase: true,
  },
};

const WHITE = '&H00FFFFFF';
/** #FACC15 in &HBBGGRR. */
const YELLOW = '&H15CCFA';

/** «H:MM:SS.cc» (centesimi), il formato dei tempi ASS. */
export function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(c)}`;
}

/** Le graffe aprono i comandi di stile e la barra rovesciata i codici: nel testo non devono esserci. */
export function assText(text: string): string {
  return text.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\\/g, '/');
}

interface Event {
  startMs: number;
  endMs: number;
  text: string;
}

/** Eventi nei tempi del video montato (i tagli spostano tutto indietro). */
function events(
  captions: readonly Caption[],
  cuts: readonly TimeRange[],
  style: SubtitleStyle,
): Event[] {
  const at = (ms: number) => editedTimeMs(cuts, ms);
  const upper = STYLES[style].uppercase;
  const word = (text: string) => assText(upper ? text.toUpperCase() : text);
  const result: Event[] = [];
  for (const caption of captions) {
    if (style === 'clean' || style === 'box') {
      result.push({
        startMs: at(caption.startMs),
        endMs: at(caption.endMs),
        text: caption.words.map((w) => word(w.text)).join(' '),
      });
      continue;
    }
    // Una riga per parola: dall'inizio della parola all'inizio della successiva.
    caption.words.forEach((active, i) => {
      const next = caption.words[i + 1];
      const startMs = at(active.startMs);
      const endMs = at(next ? next.startMs : caption.endMs);
      if (endMs <= startMs) return;
      const text =
        style === 'big'
          ? word(active.text)
          : caption.words
              .map((w, j) =>
                j === i ? `{\\c${YELLOW}&}${word(w.text)}{\\c${WHITE}&}` : word(w.text),
              )
              .join(' ');
      result.push({ startMs, endMs, text });
    });
  }
  return result;
}

export function buildAss(options: {
  captions: readonly Caption[];
  cuts: readonly TimeRange[];
  style: SubtitleStyle;
  width: number;
  height: number;
}): string {
  const { width, height, style } = options;
  const spec = STYLES[style];
  const px = (factor: number) => Math.max(0, Math.round(height * factor));
  const margin = Math.round(width * 0.06);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Segoe UI,${px(spec.size)},${WHITE},&H000000FF,&H00000000,${spec.back},${spec.bold ? -1 : 0},0,0,0,100,100,0,0,${spec.borderStyle},${px(spec.outline)},${px(spec.shadow)},2,${margin},${margin},${px(spec.marginV)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = events(options.captions, options.cuts, style).map(
    (e) => `Dialogue: 0,${assTime(e.startMs)},${assTime(e.endMs)},Default,,0,0,0,,${e.text}`,
  );
  return `${[...header, ...lines].join('\n')}\n`;
}
