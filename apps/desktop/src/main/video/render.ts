import { isTrackInFolder } from './music.js';
import {
  VIDEO_FORMAT_INFO,
  buildCaptions,
  cropRect,
  editedDurationMs,
  keptRanges,
  zoomedParts,
  videoRenderKey,
  type VideoJobProgress,
  type VideoProject,
  type VideoTool,
} from '@prisma-app/shared';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAss } from './ass.js';
import type { ProcessRunner } from './process.js';
import {
  buildFilterGraph,
  ffmpegRenderArgs,
  loudnessArgs,
  loudnessGraph,
  mixLoudnessArgs,
  mixLoudnessGraph,
  voiceGainFromLoudnorm,
} from './render-plan.js';
import type { LocalStore } from './store.js';
import { ffmpegProgress } from './whisper.js';

export interface RenderDeps {
  store: LocalStore;
  requireTool: (tool: VideoTool) => Promise<string>;
  workRoot: string;
  /** Cartella degli export (la stessa dei caroselli): da qui i file si caricano su R2. */
  exportsRoot: string;
  run: ProcessRunner;
  emit: (progress: VideoJobProgress) => void;
  now?: () => Date;
  /**
   * Durata reale del file prodotto (ffprobe): i tagli cadono sul fotogramma più vicino, quindi
   * con molti tagli brevi può differire da quella calcolata. Assente → si usa quella calcolata.
   */
  measureDurationMs?: (path: string) => Promise<number>;
  /** Cartella della musica: il render usa solo brani che stanno lì (6b). */
  musicDir?: () => Promise<string | null>;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** sha256 di un file letto a flusso (i video possono essere grandi). */
export function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** «video-<id>/20261122-120000-9x16.mp4» */
export function renderFileName(projectId: string, format: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return join(`video-${projectId}`, `${stamp}-${format.replace(':', 'x')}.mp4`);
}

/**
 * Esporta il video montato: tagli, ritaglio del formato, scala e sottotitoli in un solo
 * passaggio di FFmpeg. Il risultato (con il suo sha256 e la chiave delle modifiche) finisce in
 * `project.render`.
 */
export function createRenderService(deps: RenderDeps) {
  const running = new Map<string, AbortController>();
  const now = deps.now ?? (() => new Date());

  async function render(projectId: string): Promise<VideoProject> {
    const project = deps.store.getProject(projectId);
    if (!project) throw new Error('Progetto video non trovato');
    if (running.has(projectId)) throw new Error('Esportazione già in corso per questo video');
    const ffmpeg = await deps.requireTool('ffmpeg');
    const music = project.edit.audio.music;
    if (music && !isTrackInFolder((await deps.musicDir?.()) ?? null, music.path)) {
      throw new Error('Il brano non è nella cartella della musica: sceglilo di nuovo nell’editor');
    }
    const { source, edit } = project;
    const kept = keptRanges(edit.cuts, source.durationMs);
    const info = VIDEO_FORMAT_INFO[edit.format];
    const duration = editedDurationMs(edit.cuts, source.durationMs);
    const captions = project.transcript ? buildCaptions(project.transcript.words, edit.cuts) : [];
    const parts = zoomedParts(kept, edit.zooms);

    const controller = new AbortController();
    running.set(projectId, controller);
    const workDir = join(deps.workRoot, `${projectId}-render`);
    const output = join(deps.exportsRoot, renderFileName(projectId, edit.format, now()));
    try {
      await mkdir(workDir, { recursive: true });
      await mkdir(join(output, '..'), { recursive: true });
      const subtitles = captions.length > 0 || edit.hook ? 'sottotitoli.ass' : null;
      if (subtitles) {
        await writeFile(
          join(workDir, subtitles),
          buildAss({
            captions,
            cuts: edit.cuts,
            style: edit.subtitles,
            width: info.width,
            height: info.height,
            keywords: edit.keywords,
            hook: edit.hook,
          }),
          'utf8',
        );
      }
      // Prima si misura la voce (solo audio, veloce): guadagno fisso per il volume uniforme e
      // livello di riferimento per il gate delle pause.
      let voiceGainDb: number | null = null;
      if ((edit.audio.normalize || edit.audio.clean) && source.hasAudio) {
        deps.emit({ projectId, stage: 'render', percent: null });
        await writeFile(join(workDir, 'misura.txt'), loudnessGraph(kept, edit.audio), 'utf8');
        const lines: string[] = [];
        const measured = await deps.run(ffmpeg, loudnessArgs(source.path, 'misura.txt'), {
          cwd: workDir,
          signal: controller.signal,
          onLine: (line) => lines.push(line),
        });
        if (measured.code === 0) voiceGainDb = voiceGainFromLoudnorm(lines.join('\n'));
      }
      // Con la musica si misura anche il mix: le pause con la musica abbassano il volume medio.
      let mixGainDb: number | null = null;
      if (edit.audio.normalize && edit.audio.music) {
        await writeFile(
          join(workDir, 'misura-mix.txt'),
          mixLoudnessGraph(kept, source.hasAudio, { ...edit.audio, voiceGainDb }),
          'utf8',
        );
        const lines: string[] = [];
        const measured = await deps.run(
          ffmpeg,
          mixLoudnessArgs(source.path, edit.audio.music.path, 'misura-mix.txt'),
          { cwd: workDir, signal: controller.signal, onLine: (line) => lines.push(line) },
        );
        if (measured.code === 0) mixGainDb = voiceGainFromLoudnorm(lines.join('\n'));
      }
      await writeFile(
        join(workDir, 'filtri.txt'),
        buildFilterGraph({
          parts,
          crop: cropRect(edit.format, source.width, source.height, edit.cropOffset),
          width: info.width,
          height: info.height,
          hasAudio: source.hasAudio,
          subtitles,
          audio: { ...edit.audio, voiceGainDb, mixGainDb },
        }),
        'utf8',
      );

      deps.emit({ projectId, stage: 'render', percent: 0 });
      const result = await deps.run(
        ffmpeg,
        ffmpegRenderArgs({
          source: source.path,
          graphFile: 'filtri.txt',
          output,
          hasAudio: source.hasAudio,
          music: edit.audio.music?.path ?? null,
        }),
        {
          cwd: workDir,
          signal: controller.signal,
          onLine: (line) => {
            const percent = ffmpegProgress(line, duration);
            if (percent !== null) deps.emit({ projectId, stage: 'render', percent });
          },
        },
      );
      if (result.code !== 0) {
        const last =
          result.stderrTail.trim().split('\n').filter(Boolean).pop() ?? 'errore sconosciuto';
        throw new Error(`FFmpeg non ha esportato il video: ${last.slice(0, 300)}`);
      }

      const measured = await deps.measureDurationMs?.(output).catch(() => null);
      const updated: VideoProject = {
        ...project,
        render: {
          path: output,
          format: edit.format,
          width: info.width,
          height: info.height,
          durationMs: measured ?? duration,
          sizeBytes: (await stat(output)).size,
          checksumSha256: await fileSha256(output),
          origin: 'prisma',
          renderKey: sha256Hex(videoRenderKey(project)),
          createdAt: now().toISOString(),
        },
        updatedAt: now().toISOString(),
      };
      deps.store.updateProject(updated);
      return updated;
    } catch (error) {
      await rm(output, { force: true });
      if (controller.signal.aborted) throw new Error('Esportazione annullata', { cause: error });
      throw error;
    } finally {
      running.delete(projectId);
      await rm(workDir, { recursive: true, force: true });
    }
  }

  return {
    render,
    cancel: (projectId: string): void => running.get(projectId)?.abort(),
    isRunning: (projectId: string): boolean => running.has(projectId),
    /** Il file esportato corrisponde ancora alle modifiche attuali. */
    /**
     * Il file corrisponde alle modifiche. Quello rientrato da FilmCraft è sempre valido: è stato
     * montato là, le modifiche di Prisma non lo riguardano.
     */
    isUpToDate: (project: VideoProject): boolean =>
      project.render?.origin === 'filmcraft' ||
      project.render?.renderKey === sha256Hex(videoRenderKey(project)),
  };
}

export type RenderService = ReturnType<typeof createRenderService>;
