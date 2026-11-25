import { isTrackInFolder } from './music.js';
import {
  DEFAULT_BRAND_KIT,
  VIDEO_FORMAT_INFO,
  buildCaptions,
  cropRectForAspect,
  editedTimeMs,
  effectiveLayout,
  followPath,
  formatAspect,
  freeAxis,
  layoutBoxes,
  type BrandKit,
  type CarouselTemplate,
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
import { renderOverlayCardHtml, templatePalette } from '@prisma-app/templates';
import {
  buildFilterGraph,
  ffmpegRenderArgs,
  loudnessArgs,
  loudnessGraph,
  mixLoudnessArgs,
  mixLoudnessGraph,
  voiceGainFromLoudnorm,
  audioOnlyArgs,
  audioOnlyGraph,
  needsMix,
  type Composition,
  type CropFollow,
  type VideoLayer,
} from './render-plan.js';
import { ffmpegColor } from './slideshow.js';
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
  /** Schede di testo in PNG trasparente (finestra offscreen, 6d). */
  captureCard?: (html: string, width: number, height: number) => Promise<Buffer>;
  fontFaceCss?: () => Promise<string>;
  /** Il B-roll sta nella cartella dell'utente o nella cache di Pixabay (6d). */
  brollAllowed?: (path: string) => Promise<boolean>;
}

/** Brand kit e template con cui disegnare le schede; senza, quelli predefiniti. */
export interface RenderLook {
  kit: BrandKit;
  template: CarouselTemplate;
}

/** Proporzioni del riquadro della webcam: quelle del formato o del suo posto nel layout (6f). */
export function cameraAspect(project: VideoProject): number {
  const { edit } = project;
  const layout = effectiveLayout(edit.layout, edit.format, project.screen !== null);
  const box = layoutBoxes(layout, edit.format).camera;
  return box ? box.width / box.height : formatAspect(edit.format);
}

/** Webcam e schermo nel layout scelto; null senza schermo o con «Solo tu». */
export function composition(
  project: VideoProject,
  screenInput: number,
  background: string,
): Composition | null {
  const { edit, screen } = project;
  if (!screen) return null;
  const layout = effectiveLayout(edit.layout, edit.format, true);
  if (layout === 'camera') return null;
  const boxes = layoutBoxes(layout, edit.format);
  return {
    layout,
    camera: boxes.camera,
    screen: boxes.screen,
    screenInput,
    offsetMs: screen.offsetMs,
    screenDurationMs: screen.durationMs,
    background,
  };
}

/** Il ritaglio segue il volto se richiesto, analizzato e se il riquadro lascia un asse libero. */
export function cropFollow(project: VideoProject): CropFollow | null {
  const { edit, source, faces } = project;
  if (!edit.followFace || !faces) return null;
  const aspect = cameraAspect(project);
  const axis = freeAxis(aspect, source.width, source.height);
  if (!axis) return null;
  const crop = cropRectForAspect(aspect, source.width, source.height, 0);
  return {
    path: followPath(faces, aspect, source.width, source.height, edit.cropOffset),
    fallback: edit.cropOffset,
    axis,
    travel: axis === 'x' ? source.width - crop.width : source.height - crop.height,
  };
}

/** Tempi sul video montato (secondi) di un intervallo del sorgente; null se è tutto tagliato. */
export function editedWindow(
  cuts: VideoProject['edit']['cuts'],
  range: { startMs: number; endMs: number },
): { startS: number; endS: number } | null {
  const startS = editedTimeMs(cuts, range.startMs) / 1000;
  const endS = editedTimeMs(cuts, range.endMs) / 1000;
  return endS - startS >= 0.3 ? { startS, endS } : null;
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

  /**
   * Misure del volume prima del render (solo audio, veloci): guadagno della voce per il volume
   * uniforme e il gate, e con la musica correzione del mix (le pause con la musica contano).
   */
  async function measureGains(
    project: VideoProject,
    kept: ReturnType<typeof keptRanges>,
    ffmpeg: string,
    workDir: string,
    signal: AbortSignal,
  ): Promise<{ voiceGainDb: number | null; mixGainDb: number | null }> {
    const { source, edit } = project;
    let voiceGainDb: number | null = null;
    if ((edit.audio.normalize || edit.audio.clean) && source.hasAudio) {
      await writeFile(join(workDir, 'misura.txt'), loudnessGraph(kept, edit.audio), 'utf8');
      const lines: string[] = [];
      const measured = await deps.run(ffmpeg, loudnessArgs(source.path, 'misura.txt'), {
        cwd: workDir,
        signal,
        onLine: (line) => lines.push(line),
      });
      if (measured.code === 0) voiceGainDb = voiceGainFromLoudnorm(lines.join('\n'));
    }
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
        { cwd: workDir, signal, onLine: (line) => lines.push(line) },
      );
      if (measured.code === 0) mixGainDb = voiceGainFromLoudnorm(lines.join('\n'));
    }
    return { voiceGainDb, mixGainDb };
  }

  /**
   * Livelli sopra il video montato: B-roll sotto, schede sopra (PNG trasparenti scritti in
   * `dir`); si saltano quelli caduti in parti tagliate.
   */
  async function prepareLayers(
    project: VideoProject,
    look: RenderLook | undefined,
    dir: string,
  ): Promise<VideoLayer[]> {
    const { edit } = project;
    const info = VIDEO_FORMAT_INFO[edit.format];
    const layers: VideoLayer[] = [];
    for (const item of edit.broll) {
      const window = editedWindow(edit.cuts, item);
      if (window) {
        layers.push({
          kind: item.media.kind === 'video' ? 'broll-video' : 'broll-image',
          file: item.media.path,
          ...window,
        });
      }
    }
    if (edit.overlays.length > 0) {
      if (!deps.captureCard) throw new Error('Schede di testo non disponibili');
      const fontFaceCss = (await deps.fontFaceCss?.()) ?? '';
      for (const [i, overlay] of edit.overlays.entries()) {
        const window = editedWindow(edit.cuts, overlay);
        if (!window) continue;
        const html = renderOverlayCardHtml({
          overlay,
          kit: look?.kit ?? DEFAULT_BRAND_KIT,
          template: look?.template ?? 'scuro',
          width: info.width,
          height: info.height,
          fontFaceCss,
        });
        const file = `scheda-${i + 1}.png`;
        await writeFile(join(dir, file), await deps.captureCard(html, info.width, info.height));
        layers.push({ kind: 'card', file, ...window });
      }
    }
    return layers;
  }

  /** Controlli prima di usare musica e B-roll (solo file delle loro cartelle). */
  async function checkSources(project: VideoProject): Promise<void> {
    const music = project.edit.audio.music;
    if (music && !isTrackInFolder((await deps.musicDir?.()) ?? null, music.path)) {
      throw new Error('Il brano non è nella cartella della musica: sceglilo di nuovo nell’editor');
    }
    for (const item of project.edit.broll) {
      if (!(await deps.brollAllowed?.(item.media.path))) {
        throw new Error(
          `Il B-roll «${item.media.fileName}» non è più disponibile: sceglilo di nuovo nell’editor`,
        );
      }
    }
  }

  /**
   * Per FilmCraft: schede (PNG in `dir`, percorsi assoluti), B-roll e, se l'audio va lavorato,
   * l'audio del video montato in WAV (voce ripulita, volume uniforme, musica).
   */
  async function prepareForFilmcraft(
    project: VideoProject,
    look: RenderLook | undefined,
    dir: string,
  ): Promise<{ layers: VideoLayer[]; audio: string | null }> {
    await checkSources(project);
    const layers = (await prepareLayers(project, look, dir)).map((layer) =>
      layer.kind === 'card' ? { ...layer, file: join(dir, layer.file) } : layer,
    );
    const { source, edit } = project;
    if (!needsMix(edit.audio, source.hasAudio)) return { layers, audio: null };
    const ffmpeg = await deps.requireTool('ffmpeg');
    const kept = keptRanges(edit.cuts, source.durationMs);
    const signal = new AbortController().signal;
    const gains = await measureGains(project, kept, ffmpeg, dir, signal);
    await writeFile(
      join(dir, 'audio.txt'),
      audioOnlyGraph(kept, source.hasAudio, { ...edit.audio, ...gains }),
      'utf8',
    );
    const output = join(dir, 'audio-prisma.wav');
    const result = await deps.run(
      ffmpeg,
      audioOnlyArgs(source.path, edit.audio.music?.path ?? null, 'audio.txt', output),
      { cwd: dir },
    );
    if (result.code !== 0) {
      const last = result.stderrTail.trim().split('\n').filter(Boolean).pop() ?? 'errore';
      throw new Error(`FFmpeg non ha preparato l’audio per FilmCraft: ${last.slice(0, 300)}`);
    }
    return { layers, audio: output };
  }

  async function render(projectId: string, look?: RenderLook): Promise<VideoProject> {
    const project = deps.store.getProject(projectId);
    if (!project) throw new Error('Progetto video non trovato');
    if (running.has(projectId)) throw new Error('Esportazione già in corso per questo video');
    const ffmpeg = await deps.requireTool('ffmpeg');
    await checkSources(project);
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
      deps.emit({ projectId, stage: 'render', percent: null });
      const { voiceGainDb, mixGainDb } = await measureGains(
        project,
        kept,
        ffmpeg,
        workDir,
        controller.signal,
      );
      const layers = await prepareLayers(project, look, workDir);
      await writeFile(
        join(workDir, 'filtri.txt'),
        buildFilterGraph({
          parts,
          crop: cropRectForAspect(
            cameraAspect(project),
            source.width,
            source.height,
            edit.cropOffset,
          ),
          width: info.width,
          height: info.height,
          hasAudio: source.hasAudio,
          subtitles,
          audio: { ...edit.audio, voiceGainDb, mixGainDb },
          layers,
          firstLayerInput: edit.audio.music ? 2 : 1,
          follow: cropFollow(project),
          composition: composition(
            project,
            (edit.audio.music ? 2 : 1) + layers.length,
            ffmpegColor(
              templatePalette(look?.template ?? 'scuro', (look?.kit ?? DEFAULT_BRAND_KIT).colors)
                .bg,
            ),
          ),
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
          layers,
          screen: composition(project, 0, '0x000000') ? project.screen!.path : null,
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
    prepareForFilmcraft,
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
