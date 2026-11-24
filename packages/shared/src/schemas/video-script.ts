import { z } from 'zod';
import { CAROUSEL_LIMITS, SlideSchema, type Carousel, type CarouselTemplate } from './carousel.js';
import { IdSchema } from './common.js';
import type { TranscriptWord } from './transcript.js';
import { bareWord } from './video-auto-edit.js';

/**
 * «Crea video dall'idea» (fase 6c): l'LLM scrive un copione di circa 45 secondi diviso in scene;
 * ogni scena ha il testo da leggere (voce locale) e una slide del brand kit da mostrare intanto.
 * Il desktop ne ricava un video verticale che si apre nell'editor come un video importato.
 */

export const VIDEO_SCRIPT_LIMITS = {
  targetSeconds: 45,
  minScenes: 3,
  maxScenes: 8,
  narrationMax: 400,
  /** Velocità di lettura stimata della voce locale (parole al secondo). */
  wordsPerSecond: 2.4,
  /** Parole totali ammesse: circa 30–65 secondi letti. */
  minWords: 70,
  maxWords: 160,
} as const;

/** Da un'idea o dal testo di una bozza (variant). */
export const VideoScriptRequestSchema = z.union([
  z.object({ ideaId: IdSchema }).strict(),
  z.object({ variantId: IdSchema }).strict(),
]);
export type VideoScriptRequest = z.infer<typeof VideoScriptRequestSchema>;

export const VideoSceneSchema = z.object({
  /** Testo letto dalla voce: frasi intere, niente simboli o markdown. */
  narration: z.string().trim().min(1).max(VIDEO_SCRIPT_LIMITS.narrationMax),
  slide: SlideSchema,
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const VideoScriptSchema = z.object({
  brandId: IdSchema,
  title: z.string().trim().min(1).max(200),
  kicker: z.string().trim().max(CAROUSEL_LIMITS.kickerMax).default(''),
  scenes: z
    .array(VideoSceneSchema)
    .min(VIDEO_SCRIPT_LIMITS.minScenes)
    .max(VIDEO_SCRIPT_LIMITS.maxScenes),
});
export type VideoScript = z.infer<typeof VideoScriptSchema>;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Durata stimata della lettura, in secondi. */
export function estimatedSeconds(scenes: readonly Pick<VideoScene, 'narration'>[]): number {
  const words = scenes.reduce((total, scene) => total + countWords(scene.narration), 0);
  return Math.round(words / VIDEO_SCRIPT_LIMITS.wordsPerSecond);
}

/** Le slide del copione come carosello, per disegnarle con `renderSlideHtml`. */
export function scriptCarousel(script: VideoScript, template: CarouselTemplate): Carousel {
  return { template, kicker: script.kicker, slides: script.scenes.map((scene) => scene.slide) };
}

/**
 * Testo per la voce: punteggiatura tipografica resa semplice, simboli letti a parole, niente
 * emoji. Restano lettere latine (con gli accenti italiani), cifre e la punteggiatura che dà le
 * pause: così passa anche dalla riga di comando di Windows (`ansiArgument`).
 */
export function speechText(text: string): string {
  const replaced = text
    .normalize('NFC')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[–—]/g, ', ')
    .replace(/…/g, '...')
    .replace(/\s*&\s*/g, ' e ')
    .replace(/(\d)\s*%/g, '$1 per cento')
    .replace(/\s*\+\s*/g, ' più ')
    .replace(/\s*€\s*/g, ' euro ');
  const kept = [...replaced]
    .map((char) => {
      if (/[A-Za-z0-9\s.,;:!?'"()\-/]/.test(char)) return char;
      if (/[àèéìíòóùúÀÈÉÌÒÓÙÚ]/.test(char)) return char;
      // Altre lettere accentate: la lettera senza segno; tutto il resto diventa uno spazio.
      const bare = char.normalize('NFD').replace(/\p{M}/gu, '');
      return /^[A-Za-z]$/.test(bare) ? bare : ' ';
    })
    .join('');
  return kept
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Parole con tempi stimati, quando whisper.cpp non c'è: ogni scena occupa il suo intervallo e le
 * parole si dividono il tempo della voce in proporzione alla lunghezza.
 */
export function estimatedWords(
  scenes: ReadonlyArray<{ narration: string; startMs: number; speechMs: number }>,
): Array<{ text: string; startMs: number; endMs: number; p: number }> {
  return scenes.flatMap((scene) => {
    const words = scene.narration.split(/\s+/).filter(Boolean);
    const weights = words.map((w) => w.length + 1);
    const total = weights.reduce((t, w) => t + w, 0);
    let done = 0;
    let at = scene.startMs;
    return words.map((text, i) => {
      done += weights[i]!;
      const end = Math.max(at + 1, scene.startMs + Math.round((scene.speechMs * done) / total));
      const word = { text, startMs: at, endMs: end, p: 1 };
      at = end;
      return word;
    });
  });
}

/**
 * Il testo del copione con i tempi di whisper.cpp. Il copione è esatto, ma la voce sintetica
 * a volte viene capita male («bug» → «buco»): si allineano le due sequenze di parole (distanza
 * di modifica) e ogni parola del copione prende i tempi della parola sentita al suo posto. Le
 * parole del copione senza corrispondenza si dividono il tempo tra le vicine; quelle sentite in
 * più allungano la parola precedente.
 */
export function alignScriptWords(
  script: readonly string[],
  heard: readonly TranscriptWord[],
): TranscriptWord[] {
  const n = script.length;
  const m = heard.length;
  if (n === 0 || m === 0) return [];
  const a = script.map(bareWord);
  const b = heard.map((w) => bareWord(w.text));
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
    }
  }

  // Ripercorre la tabella dalla fine: per ogni parola del copione l'indice sentito (o null).
  const match: Array<number | null> = new Array<number | null>(n).fill(null);
  const extra: Array<number | null> = new Array<number | null>(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = cost[i]![j]!;
    if (i > 0 && j > 0 && here === cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      match[i - 1] = j - 1;
      i--;
      j--;
    } else if (j > 0 && (i === 0 || here === cost[i]![j - 1]! + 1)) {
      // Parola sentita in più: allunga la parola del copione che la precede.
      if (i > 0) extra[i - 1] = Math.max(extra[i - 1] ?? -1, j - 1);
      j--;
    } else {
      i--;
    }
  }

  const words: TranscriptWord[] = script.map((text, k) => {
    const index = match[k];
    if (index === null || index === undefined) return { text, startMs: -1, endMs: -1, p: 0.5 };
    const word = heard[index]!;
    const last = extra[k];
    const endMs = last !== null && last !== undefined ? heard[last]!.endMs : word.endMs;
    return { text, startMs: word.startMs, endMs: Math.max(endMs, word.startMs + 1), p: word.p };
  });

  // Parole senza corrispondenza: si dividono lo spazio tra la precedente e la successiva.
  for (let k = 0; k < n; k++) {
    if (words[k]!.startMs >= 0) continue;
    let end = k;
    while (end < n && words[end]!.startMs < 0) end++;
    const from = k > 0 ? words[k - 1]!.endMs : 0;
    const to =
      end < n ? words[end]!.startMs : Math.max(from + (end - k) * 300, heard[m - 1]!.endMs);
    const step = Math.max(1, Math.floor((to - from) / (end - k)));
    for (let x = k; x < end; x++) {
      const startMs = from + (x - k) * step;
      words[x] = { ...words[x]!, startMs, endMs: Math.max(startMs + 1, startMs + step) };
    }
    k = end - 1;
  }
  return words;
}
