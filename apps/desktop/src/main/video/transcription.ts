import type {
  TranscriptLanguage,
  VideoJobProgress,
  VideoProject,
  VideoTool,
} from '@prisma-app/shared';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, join } from 'node:path';
import type { ProcessRunner } from './process.js';
import type { LocalStore } from './store.js';
import {
  ffmpegAudioArgs,
  ffmpegProgress,
  parseWhisperJson,
  whisperArgs,
  whisperProgress,
} from './whisper.js';

export interface TranscriptionDeps {
  store: LocalStore;
  requireTool: (tool: VideoTool) => Promise<string>;
  /** Cartella di lavoro: un file WAV temporaneo per progetto. */
  workRoot: string;
  run: ProcessRunner;
  emit: (progress: VideoJobProgress) => void;
  now?: () => Date;
  /** Thread di whisper: sul processore conviene usarne più dei 4 predefiniti. */
  threads?: number;
}

/**
 * Trascrizione in locale: FFmpeg estrae l'audio (16 kHz mono), whisper.cpp lo trascrive con i
 * tempi per token, le parole finiscono nel progetto. Un lavoro alla volta per progetto,
 * annullabile; i file temporanei si cancellano sempre.
 */
export function createTranscriptionService(deps: TranscriptionDeps) {
  const running = new Map<string, AbortController>();
  const now = deps.now ?? (() => new Date());
  const threads = deps.threads ?? Math.max(1, Math.min(8, availableParallelism() - 1));

  async function transcribe(
    projectId: string,
    language: TranscriptLanguage,
  ): Promise<VideoProject> {
    const project = deps.store.getProject(projectId);
    if (!project) throw new Error('Progetto video non trovato');
    if (running.has(projectId)) throw new Error('Trascrizione già in corso per questo video');
    const [ffmpeg, whisper, model] = await Promise.all([
      deps.requireTool('ffmpeg'),
      deps.requireTool('whisper'),
      deps.requireTool('whisperModel'),
    ]);

    const controller = new AbortController();
    running.set(projectId, controller);
    const workDir = join(deps.workRoot, projectId);
    const wav = join(workDir, 'audio.wav');
    const outputBase = join(workDir, 'trascrizione');
    try {
      await mkdir(workDir, { recursive: true });

      deps.emit({ projectId, stage: 'audio', percent: 0 });
      const audio = await deps.run(ffmpeg, ffmpegAudioArgs(project.source.path, wav), {
        signal: controller.signal,
        onLine: (line) => {
          const percent = ffmpegProgress(line, project.source.durationMs);
          if (percent !== null) deps.emit({ projectId, stage: 'audio', percent });
        },
      });
      if (audio.code !== 0)
        throw new Error(`FFmpeg non ha estratto l’audio: ${lastLine(audio.stderrTail)}`);

      deps.emit({ projectId, stage: 'trascrizione', percent: 0 });
      const result = await deps.run(
        whisper,
        whisperArgs({ model, wav, outputBase, language, threads }),
        {
          signal: controller.signal,
          onLine: (line) => {
            const percent = whisperProgress(line);
            if (percent !== null) deps.emit({ projectId, stage: 'trascrizione', percent });
          },
        },
      );
      if (result.code !== 0)
        throw new Error(`whisper.cpp si è fermato: ${lastLine(result.stderrTail)}`);

      const parsed = parseWhisperJson(JSON.parse(await readFile(`${outputBase}.json`, 'utf8')));
      const updated: VideoProject = {
        ...project,
        transcript: {
          language: parsed.language,
          model: basename(model),
          words: parsed.words,
          createdAt: now().toISOString(),
        },
        updatedAt: now().toISOString(),
      };
      deps.store.updateProject(updated);
      return updated;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Trascrizione annullata', { cause: error });
      throw error;
    } finally {
      running.delete(projectId);
      await rm(workDir, { recursive: true, force: true });
    }
  }

  return {
    transcribe,
    cancel(projectId: string): void {
      running.get(projectId)?.abort();
    },
    isRunning: (projectId: string): boolean => running.has(projectId),
  };
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? 'errore sconosciuto').slice(0, 300);
}

export type TranscriptionService = ReturnType<typeof createTranscriptionService>;
