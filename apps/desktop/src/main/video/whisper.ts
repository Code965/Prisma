import type { TranscriptLanguage, TranscriptWord } from '@prisma-app/shared';

/**
 * whisper.cpp (`whisper-cli`, README ed examples/cli verificati novembre 2026): legge WAV a
 * 16 bit, quindi l'audio si estrae prima con FFmpeg a 16 kHz mono. `-ojf` scrive il JSON
 * completo con i token e i loro tempi (`offsets` in millisecondi); `-pp` stampa su stderr
 * «whisper_print_progress_callback: progress =  45%» ogni 5%.
 */

export function ffmpegAudioArgs(source: string, wav: string): string[] {
  return [
    '-y',
    '-nostdin',
    '-i',
    source,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-progress',
    'pipe:1',
    '-nostats',
    wav,
  ];
}

/** `out_time_ms` di `-progress` è in microsecondi (nonostante il nome). */
export function ffmpegProgress(line: string, durationMs: number): number | null {
  const match = /^out_time_(?:ms|us)=(\d+)$/.exec(line.trim());
  if (!match || durationMs <= 0) return null;
  return Math.min(100, Math.round((Number(match[1]) / 1000 / durationMs) * 100));
}

export function whisperArgs(options: {
  model: string;
  wav: string;
  outputBase: string;
  language: TranscriptLanguage;
  threads: number;
}): string[] {
  return [
    '-m',
    options.model,
    '-f',
    options.wav,
    '-l',
    options.language,
    '-t',
    String(options.threads),
    '-ojf',
    '-of',
    options.outputBase,
    '-pp',
  ];
}

export function whisperProgress(line: string): number | null {
  const match = /progress\s*=\s*(\d+)%/.exec(line);
  return match ? Math.min(100, Number(match[1])) : null;
}

interface WhisperToken {
  text?: string;
  offsets?: { from?: number; to?: number };
  p?: number;
}

interface WhisperOutput {
  result?: { language?: string };
  transcription?: Array<{ text?: string; tokens?: WhisperToken[] }>;
}

/** Token speciali di whisper ([_BEG_], [_TT_123], <|endoftext|>…): non sono parole. */
function isSpecial(text: string): boolean {
  return /^\s*(\[_[^\]]*\]|<\|[^|]*\|>)\s*$/.test(text);
}

const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

/**
 * Parole con i loro tempi dai token di `-ojf`: un token che inizia con uno spazio apre una nuova
 * parola, gli altri (pezzi di parola, punteggiatura) si attaccano alla precedente.
 */
export function parseWhisperJson(output: WhisperOutput): {
  language: string;
  words: TranscriptWord[];
} {
  const words: TranscriptWord[] = [];
  let current: { text: string; startMs: number; endMs: number; probs: number[] } | null = null;
  const flush = () => {
    if (current && current.text.trim()) {
      const p = current.probs.reduce((a, b) => a + b, 0) / Math.max(1, current.probs.length);
      words.push({
        text: current.text.trim(),
        startMs: current.startMs,
        endMs: Math.max(current.endMs, current.startMs),
        p: Math.round(p * 1000) / 1000,
      });
    }
    current = null;
  };

  for (const segment of output.transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      const text = token.text ?? '';
      if (!text || isSpecial(text)) continue;
      const from = token.offsets?.from ?? 0;
      const to = token.offsets?.to ?? from;
      const p = Math.min(1, Math.max(0, token.p ?? 0));
      const startsWord = /^\s/.test(text) && !PUNCTUATION_ONLY.test(text.trim());
      if (!current || startsWord) {
        flush();
        current = { text, startMs: from, endMs: to, probs: [p] };
      } else {
        current.text += text;
        current.endMs = to;
        current.probs.push(p);
      }
    }
    // Un segmento finisce sempre con una parola intera.
    flush();
  }
  flush();
  return { language: output.result?.language ?? 'auto', words };
}
