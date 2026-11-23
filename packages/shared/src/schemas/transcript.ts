import { z } from 'zod';
import { InstantSchema } from './common.js';

/**
 * Trascrizione di un video con i tempi parola per parola (whisper.cpp, fase 3b). È la base del
 * montaggio dal testo: cancellare parole o segmenti taglia il video.
 */
export const TranscriptWordSchema = z.object({
  text: z.string().min(1),
  startMs: z.int().nonnegative(),
  endMs: z.int().nonnegative(),
  /** Probabilità media dei token (0–1): le parole incerte si possono evidenziare. */
  p: z.number().min(0).max(1),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TRANSCRIPT_LANGUAGES = ['it', 'en', 'auto'] as const;
export type TranscriptLanguage = (typeof TRANSCRIPT_LANGUAGES)[number];

export const TRANSCRIPT_LANGUAGE_LABELS: Record<TranscriptLanguage, string> = {
  it: 'Italiano',
  en: 'Inglese',
  auto: 'Rileva da solo',
};

export const TranscriptSchema = z.object({
  /** Lingua riconosciuta (codice di whisper, es. "it"). */
  language: z.string(),
  /** Nome del file del modello usato (es. ggml-small.bin). */
  model: z.string(),
  words: z.array(TranscriptWordSchema),
  createdAt: InstantSchema,
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/** Segmento della trascrizione: una frase parlata o una pausa abbastanza lunga da tagliare. */
export type TranscriptSegment =
  | {
      kind: 'speech';
      firstWord: number;
      lastWord: number;
      startMs: number;
      endMs: number;
      text: string;
    }
  | { kind: 'silence'; startMs: number; endMs: number };

export interface SegmentOptions {
  /** Pausa minima tra due parole per considerarla un silenzio a sé (mockup: 1,2–2,4 s). */
  silenceMs: number;
  /** Una frase si chiude anche con una pausa più breve di un silenzio. */
  sentencePauseMs: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = { silenceMs: 1000, sentencePauseMs: 600 };

const SENTENCE_END = /[.!?…]["»”']?$/;

/**
 * Divide la trascrizione in frasi e silenzi, come la colonna «Trascrizione» del mockup. Le frasi
 * finiscono con la punteggiatura o con una pausa; le pause lunghe (anche a inizio e fine video)
 * diventano segmenti di silenzio.
 */
export function transcriptSegments(
  words: readonly TranscriptWord[],
  durationMs: number,
  options: SegmentOptions = DEFAULT_SEGMENT_OPTIONS,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const silence = (startMs: number, endMs: number) => {
    if (endMs - startMs >= options.silenceMs) segments.push({ kind: 'silence', startMs, endMs });
  };
  if (words.length === 0) {
    silence(0, durationMs);
    return segments;
  }

  silence(0, words[0]!.startMs);
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    const gap = next ? next.startMs - word.endMs : Infinity;
    if (next && !SENTENCE_END.test(word.text) && gap < options.sentencePauseMs) continue;
    segments.push({
      kind: 'speech',
      firstWord: first,
      lastWord: i,
      startMs: words[first]!.startMs,
      endMs: word.endMs,
      text: words
        .slice(first, i + 1)
        .map((w) => w.text)
        .join(' '),
    });
    if (next) silence(word.endMs, next.startMs);
    first = i + 1;
  }
  silence(words[words.length - 1]!.endMs, durationMs);
  return segments;
}
