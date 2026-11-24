import {
  DEFAULT_VIDEO_EDIT,
  alignScriptWords,
  estimatedWords,
  scriptCarousel,
  speechText,
  type ToolsStatus,
  type VideoJobProgress,
  type VideoProject,
  type VideoSource,
  type VideoTool,
} from '@prisma-app/shared';
import { renderSlideHtml, templatePalette } from '@prisma-app/templates';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { GenerateVideoRequest } from '../ipc-contract.js';
import type { ProcessRunner } from './process.js';
import {
  sceneDurationMs,
  slideshowArgs,
  slideshowGraph,
  wavDurationMs,
  type SlideshowScene,
} from './slideshow.js';
import type { LocalStore } from './store.js';
import { engineLabel, speak, type SpeechEngine } from './tts.js';
import { ffmpegProgress } from './whisper.js';

export interface IdeaVideoDeps {
  store: LocalStore;
  toolsStatus: () => Promise<ToolsStatus>;
  requireTool: (tool: VideoTool) => Promise<string>;
  /** Cartella dei video creati: `<radice>/<id del lavoro>/video.mp4` resta come sorgente. */
  videosRoot: string;
  run: ProcessRunner;
  emit: (progress: VideoJobProgress) => void;
  /** Slide in JPEG 1080×1350 (finestra offscreen, come l'export dei caroselli). */
  captureSlide: (html: string) => Promise<Buffer>;
  fontFaceCss: () => Promise<string>;
  probe: (ffprobe: string, path: string) => Promise<VideoSource>;
  /** Trascrizione con whisper.cpp, se c'è: tempi delle parole più precisi della stima. */
  transcribe: (projectId: string) => Promise<VideoProject>;
  codePage: () => Promise<number | null>;
  platform?: NodeJS.Platform;
  now?: () => Date;
}

/** sherpa-onnx con una voce Piper se ci sono entrambi, altrimenti la voce di Windows. */
export function chooseEngine(
  status: ToolsStatus,
  platform: NodeJS.Platform = process.platform,
): SpeechEngine {
  const usable = (tool: VideoTool) => {
    const entry = status.find((s) => s.tool === tool);
    return entry?.path && !entry.error ? entry.path : null;
  };
  const exe = usable('tts');
  const voice = usable('ttsVoice');
  if (exe && voice) return { kind: 'sherpa', exe, voice };
  if (platform === 'win32') return { kind: 'windows' };
  throw new Error(
    'Nessuna voce disponibile: installa sherpa-onnx e una voce Piper (Impostazioni › Strumenti video)',
  );
}

/**
 * «Crea video dall'idea» (fase 6c): voce per ogni scena, slide del brand kit, montaggio con
 * FFmpeg in 9:16, poi un progetto video come quelli importati (con la trascrizione), da rifinire
 * nell'editor ed esportare. Un lavoro alla volta.
 */
export function createIdeaVideoService(deps: IdeaVideoDeps) {
  let running: { jobId: string; controller: AbortController } | null = null;
  const threads = Math.max(1, Math.min(4, availableParallelism() - 1));

  async function generate(request: GenerateVideoRequest): Promise<VideoProject> {
    if (running) throw new Error('Sto già creando un video: aspetta che finisca');
    const { jobId, script } = request;
    const [ffmpeg, ffprobe] = await Promise.all([
      deps.requireTool('ffmpeg'),
      deps.requireTool('ffprobe'),
    ]);
    const status = await deps.toolsStatus();
    const engine = chooseEngine(status, deps.platform);
    const controller = new AbortController();
    running = { jobId, controller };
    const folder = join(deps.videosRoot, jobId);
    const work = join(folder, 'lavoro');
    const emit = (stage: VideoJobProgress['stage'], percent: number | null) =>
      deps.emit({ projectId: jobId, stage, percent });
    try {
      await mkdir(work, { recursive: true });

      // 1. Voce, scena per scena.
      const codePage = await deps.codePage();
      const texts = script.scenes.map((scene) => speechText(scene.narration));
      const speechMs: number[] = [];
      for (const [i, text] of texts.entries()) {
        emit('voce', Math.round((i / texts.length) * 100));
        const file = join(work, `voce-${i + 1}.wav`);
        await speak(engine, text || '...', file, {
          run: deps.run,
          writeText: (path, content) => writeFile(path, content, 'utf8'),
          codePage,
          threads,
          signal: controller.signal,
        });
        speechMs.push(wavDurationMs(await readFile(file)));
      }

      // 2. Slide con il brand kit.
      const carousel = scriptCarousel(script, request.template);
      const fontFaceCss = await deps.fontFaceCss();
      for (let i = 0; i < carousel.slides.length; i++) {
        emit('slide', Math.round((i / carousel.slides.length) * 100));
        if (controller.signal.aborted) throw new Error('Annullato');
        const html = renderSlideHtml({
          carousel,
          index: i,
          kit: request.kit,
          initials: request.initials,
          fontFaceCss,
        });
        await writeFile(join(work, `slide-${i + 1}.jpg`), await deps.captureSlide(html));
      }

      // 3. Montaggio.
      const scenes: SlideshowScene[] = speechMs.map((ms, i) => ({
        slide: `slide-${i + 1}.jpg`,
        voice: `voce-${i + 1}.wav`,
        speechMs: ms,
      }));
      const totalMs = scenes.reduce((t, s) => t + sceneDurationMs(s.speechMs), 0);
      const background = templatePalette(request.template, request.kit.colors).bg;
      await writeFile(join(work, 'filtri.txt'), slideshowGraph(scenes, background), 'utf8');
      const output = join(folder, 'video.mp4');
      emit('montaggio', 0);
      const result = await deps.run(
        ffmpeg,
        slideshowArgs({ scenes, graphFile: 'filtri.txt', output }),
        {
          cwd: work,
          signal: controller.signal,
          onLine: (line) => {
            const percent = ffmpegProgress(line, totalMs);
            if (percent !== null) emit('montaggio', percent);
          },
        },
      );
      if (result.code !== 0) {
        const last = result.stderrTail.trim().split('\n').filter(Boolean).pop() ?? 'errore';
        throw new Error(`FFmpeg non ha montato il video: ${last.slice(0, 300)}`);
      }

      // 4. Progetto video, con la trascrizione stimata dal copione.
      const source = await deps.probe(ffprobe, output);
      let startMs = 0;
      const timed = script.scenes.map((scene, i) => {
        const entry = { narration: texts[i] ?? scene.narration, startMs, speechMs: speechMs[i]! };
        startMs += sceneDurationMs(speechMs[i]!);
        return entry;
      });
      const at = (deps.now?.() ?? new Date()).toISOString();
      const project = deps.store.createProject(source, script.title, {
        edit: { ...DEFAULT_VIDEO_EDIT, format: '9:16' },
        transcript: {
          language: 'it',
          model: 'copione',
          words: estimatedWords(timed),
          createdAt: at,
        },
        generated: {
          source: request.source.kind,
          sourceId: request.source.id,
          voice: engineLabel(engine),
          scenes: script.scenes.length,
        },
      });

      // 5. Con whisper.cpp i tempi delle parole diventano quelli veri; se non c'è, resta la stima.
      const canTranscribe = (['whisper', 'whisperModel'] as const).every((tool) => {
        const entry = status.find((s) => s.tool === tool);
        return entry?.path && !entry.error;
      });
      if (canTranscribe) {
        emit('trascrizione', null);
        try {
          const transcribed = await deps.transcribe(project.id);
          const heard = transcribed.transcript?.words ?? [];
          // Testo esatto del copione con i tempi sentiti da whisper (la voce sintetica a volte
          // viene capita male).
          const scriptWords = texts.join(' ').split(/\s+/).filter(Boolean);
          const words = alignScriptWords(scriptWords, heard);
          if (!transcribed.transcript || words.length === 0) return transcribed;
          const aligned: VideoProject = {
            ...transcribed,
            transcript: { ...transcribed.transcript, words },
          };
          deps.store.updateProject(aligned);
          return aligned;
        } catch (error) {
          console.error('Trascrizione del video creato non riuscita:', error);
        }
      }
      return project;
    } catch (error) {
      // Un video a metà non serve: si toglie tutta la cartella.
      await rm(folder, { recursive: true, force: true });
      if (controller.signal.aborted)
        throw new Error('Creazione del video annullata', { cause: error });
      throw error;
    } finally {
      running = null;
      await rm(work, { recursive: true, force: true });
    }
  }

  return {
    generate,
    cancel(jobId: string): void {
      if (running?.jobId === jobId) running.controller.abort();
    },
  };
}

export type IdeaVideoService = ReturnType<typeof createIdeaVideoService>;
