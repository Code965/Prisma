import type { TranscriptLanguage, TranscriptWord, VideoTool } from '@prisma-app/shared';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { ProcessRunner } from './process.js';
import { ffmpegAudioArgs, parseWhisperJson, whisperArgs } from './whisper.js';

export interface DictationDeps {
  requireTool: (tool: VideoTool) => Promise<string>;
  /** Cartella di lavoro: audio registrato, WAV e JSON di whisper, cancellati sempre. */
  workRoot: string;
  run: ProcessRunner;
  threads?: number;
}

/** Al massimo 5 minuti di dettatura (il renderer si ferma da solo prima). */
export const DICTATION_MAX_MS = 5 * 60 * 1000;

/** Testo dettato dalle parole di whisper: la punteggiatura è già attaccata alla parola. */
export function dictationText(words: readonly Pick<TranscriptWord, 'text'>[]): string {
  return words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?…»)])/g, '$1')
    .replace(/([«(])\s+/g, '$1')
    .trim();
}

/**
 * Dettatura delle idee: il renderer registra il microfono (WebM di MediaRecorder), il main lo
 * converte in WAV a 16 kHz con FFmpeg e lo trascrive con whisper.cpp, come per i video (3b).
 * Una dettatura alla volta, annullabile.
 */
export function createDictationService(deps: DictationDeps) {
  const threads = deps.threads ?? Math.max(1, Math.min(8, availableParallelism() - 1));
  let running: AbortController | null = null;

  async function transcribe(
    audio: Uint8Array,
    language: TranscriptLanguage,
  ): Promise<{ text: string; language: string }> {
    if (running) throw new Error('Una dettatura è già in corso');
    const [ffmpeg, whisper, model] = await Promise.all([
      deps.requireTool('ffmpeg'),
      deps.requireTool('whisper'),
      deps.requireTool('whisperModel'),
    ]);
    const controller = new AbortController();
    running = controller;
    const workDir = join(deps.workRoot, `dettatura-${randomUUID()}`);
    try {
      await mkdir(workDir, { recursive: true });
      const input = join(workDir, 'dettatura.webm');
      const wav = join(workDir, 'dettatura.wav');
      const outputBase = join(workDir, 'dettatura');
      await writeFile(input, audio);
      const converted = await deps.run(ffmpeg, ffmpegAudioArgs(input, wav), {
        signal: controller.signal,
      });
      if (converted.code !== 0) {
        throw new Error(`FFmpeg non ha letto la registrazione: ${lastLine(converted.stderrTail)}`);
      }
      const result = await deps.run(
        whisper,
        whisperArgs({ model, wav, outputBase, language, threads }),
        { signal: controller.signal },
      );
      if (result.code !== 0) {
        throw new Error(`whisper.cpp si è fermato: ${lastLine(result.stderrTail)}`);
      }
      const parsed = parseWhisperJson(JSON.parse(await readFile(`${outputBase}.json`, 'utf8')));
      return { text: dictationText(parsed.words), language: parsed.language };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Dettatura annullata', { cause: error });
      throw error;
    } finally {
      running = null;
      await rm(workDir, { recursive: true, force: true });
    }
  }

  return {
    transcribe,
    cancel(): void {
      running?.abort();
    },
  };
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? 'errore sconosciuto').slice(0, 300);
}

export type DictationService = ReturnType<typeof createDictationService>;
