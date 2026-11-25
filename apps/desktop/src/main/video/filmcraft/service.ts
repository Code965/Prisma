import {
  VIDEO_FORMATS,
  VIDEO_FORMAT_INFO,
  videoRenderKey,
  type VideoFormat,
  type VideoJobProgress,
  type VideoProject,
  type VideoSource,
} from '@prisma-app/shared';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ProcessRunner } from '../process.js';
import { fileSha256, sha256Hex, type RenderLook } from '../render.js';
import type { LocalStore } from '../store.js';
import type { VideoLayer } from '../render-plan.js';
import { createControlClient, findJob, type ControlClient } from './control.js';
import {
  buildOtio,
  buildSrt,
  placeCommands,
  placedClipIds,
  setupCommands,
  videoClipIds,
  type PlacedLayer,
} from './interchange.js';

/** FilmCraft aperto da Prisma: il canale di controllo vale finché l'app resta aperta. */
export interface FilmcraftSession {
  client: ControlClient;
  isAlive: () => boolean;
}

/** Avvia l'app grafica; il token passa solo nell'ambiente. */
export type AppLauncher = (
  exe: string,
  args: string[],
  env: Record<string, string>,
) => { isAlive: () => boolean };

export interface FilmcraftStatus {
  /** FilmCraft aperto da questa sessione di Prisma (canale di controllo disponibile). */
  connected: boolean;
  /** Le modifiche in Prisma sono cambiate dopo la creazione del progetto FilmCraft. */
  stale: boolean;
}

interface FilmcraftDeps {
  store: LocalStore;
  requireTool: (tool: 'filmcraft' | 'ffprobe') => Promise<string>;
  /** `userData/filmcraft`: un progetto FilmCraft per progetto video. */
  workRoot: string;
  exportsRoot: string;
  run: ProcessRunner;
  probe: (ffprobe: string, path: string) => Promise<VideoSource>;
  emit: (progress: VideoJobProgress) => void;
  launch?: AppLauncher;
  connect?: (port: number, token: string) => ControlClient;
  freePort?: () => Promise<number>;
  now?: () => Date;
  pollMs?: number;
  /** Schede (PNG), B-roll e audio lavorato, preparati come per l'export di Prisma (6b, 6d). */
  prepareExtras?: (
    project: VideoProject,
    look: RenderLook | undefined,
    dir: string,
  ) => Promise<{ layers: VideoLayer[]; audio: string | null }>;
}

function defaultLauncher(exe: string, args: string[], env: Record<string, string>) {
  const child = spawn(exe, args, {
    env: { ...process.env, ...env },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let alive = true;
  child.on('exit', () => (alive = false));
  child.on('error', () => (alive = false));
  return { isAlive: () => alive };
}

function localFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Formato più vicino alle proporzioni del file rientrato. */
export function nearestFormat(width: number, height: number): VideoFormat {
  const ratio = width / height;
  return [...VIDEO_FORMATS].sort((a, b) => {
    const ra = VIDEO_FORMAT_INFO[a].width / VIDEO_FORMAT_INFO[a].height;
    const rb = VIDEO_FORMAT_INFO[b].width / VIDEO_FORMAT_INFO[b].height;
    return Math.abs(ra - ratio) - Math.abs(rb - ratio);
  })[0]!;
}

export function filmcraftFileName(projectId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return join(`video-${projectId}`, `${stamp}-filmcraft.mp4`);
}

/**
 * «Apri in FilmCraft» (passo 3e, sperimentale): Prisma prepara un progetto FilmCraft con la CLI
 * (OTIO con le parti rimaste, formato, ritaglio, sottotitoli), lo apre nell'app con il canale di
 * controllo e, quando l'utente ha finito, ne fa esportare il video e lo riporta nel progetto.
 */
export function createFilmcraftService(deps: FilmcraftDeps) {
  const now = deps.now ?? (() => new Date());
  const launch = deps.launch ?? defaultLauncher;
  const connect =
    deps.connect ?? ((port: number, token: string) => createControlClient({ port, token }));
  const freePort = deps.freePort ?? localFreePort;
  const pollMs = deps.pollMs ?? 1000;
  const sessions = new Map<string, FilmcraftSession>();
  const jobs = new Map<string, AbortController>();

  function requireProject(id: string): VideoProject {
    const project = deps.store.getProject(id);
    if (!project) throw new Error('Progetto video non trovato');
    return project;
  }

  async function tools() {
    const exe = await deps.requireTool('filmcraft');
    const cli = join(dirname(exe), 'filmcraft-cli.exe');
    if (!existsSync(cli)) {
      throw new Error('Manca filmcraft-cli.exe accanto a filmcraft.exe: reinstalla FilmCraft');
    }
    return { exe, cli };
  }

  /** Esegue la CLI e restituisce lo stdout; un codice diverso da 0 è un errore leggibile. */
  async function cli(path: string, args: string[], signal?: AbortSignal): Promise<string> {
    const lines: string[] = [];
    const result = await deps.run(path, ['--compact', ...args], {
      signal,
      onLine: (line, stream) => {
        if (stream === 'stdout') lines.push(line);
      },
    });
    if (result.code !== 0) {
      const last =
        result.stderrTail.trim().split('\n').filter(Boolean).pop() ?? 'errore sconosciuto';
      throw new Error(`FilmCraft: ${last.replace(/^filmcraft-cli:\s*/, '').slice(0, 300)}`);
    }
    return lines.join('\n');
  }

  /**
   * Schede, B-roll e audio di Prisma nel progetto FilmCraft: si importano i file, si mettono
   * sulle tracce in più e gli spezzoni di B-roll riempiono il riquadro (`clip.fillFrame`).
   */
  async function addExtras(
    project: VideoProject,
    look: RenderLook | undefined,
    cliPath: string,
    fcproj: string,
    dir: string,
  ): Promise<void> {
    if (!deps.prepareExtras) return;
    const extras = await deps.prepareExtras(project, look, dir);
    const files = [...extras.layers.map((l) => l.file), ...(extras.audio ? [extras.audio] : [])];
    if (files.length === 0) return;
    const imported = JSON.parse(
      await cli(cliPath, ['--project', fcproj, '--save', 'import', ...files]),
    ) as { items?: number[] };
    const items = imported.items ?? [];
    if (items.length !== files.length)
      throw new Error('FilmCraft non ha importato schede e B-roll');
    const layers: PlacedLayer[] = extras.layers.map((layer, i) => ({
      item: items[i]!,
      kind: layer.kind,
      startS: layer.startS,
      endS: layer.endS,
    }));
    const audioItem = extras.audio ? items[extras.layers.length]! : null;
    const place = join(dir, 'livelli.jsonl');
    const steps = placeCommands(layers, audioItem);
    await writeFile(place, steps.map((step) => JSON.stringify(step)).join('\n'), 'utf8');
    const placed = placedClipIds(await cli(cliPath, ['--project', fcproj, '--save', 'run', place]));
    const brollClips = layers.flatMap((layer, i) =>
      layer.kind === 'card' ? [] : (placed[i] ?? []),
    );
    if (brollClips.length > 0) {
      const fill = join(dir, 'riempi.jsonl');
      await writeFile(
        fill,
        JSON.stringify({ id: 'clip.fillFrame', params: { clips: brollClips } }),
        'utf8',
      );
      await cli(cliPath, ['--project', fcproj, '--save', 'run', fill]);
    }
  }

  /** Crea (o ricrea) il `.fcproj` dalle modifiche attuali di Prisma. */
  async function buildProject(
    project: VideoProject,
    cliPath: string,
    look?: RenderLook,
  ): Promise<string> {
    const dir = join(deps.workRoot, project.id);
    await mkdir(dir, { recursive: true });
    const otio = join(dir, 'sequenza.otio');
    const fcproj = join(dir, 'progetto.fcproj');
    await writeFile(otio, JSON.stringify(buildOtio(project), null, 1), 'utf8');
    const srt = buildSrt(project);
    const srtPath = join(dir, 'sottotitoli.srt');
    if (srt) await writeFile(srtPath, srt, 'utf8');
    await rm(fcproj, { force: true });
    await cli(cliPath, ['--save-as', fcproj, 'import', otio]);
    const inspect = JSON.parse(await cli(cliPath, ['--project', fcproj, 'inspect', 'sequence']));
    const clips = videoClipIds(inspect);
    if (clips.length === 0) throw new Error('FilmCraft non ha importato le parti del video');
    const language = project.transcript?.language === 'en' ? 'en' : 'it';
    const steps = setupCommands(project, clips, srt ? { path: srtPath, language } : null);
    const script = join(dir, 'passi.jsonl');
    await writeFile(script, steps.map((step) => JSON.stringify(step)).join('\n'), 'utf8');
    await cli(cliPath, ['--project', fcproj, '--save', 'run', script]);
    await addExtras(project, look, cliPath, fcproj, dir);
    return fcproj;
  }

  function sessionOf(id: string): FilmcraftSession | null {
    const session = sessions.get(id);
    if (session && session.isAlive()) return session;
    if (session) {
      session.client.close();
      sessions.delete(id);
    }
    return null;
  }

  function status(project: VideoProject): FilmcraftStatus {
    return {
      connected: sessionOf(project.id) !== null,
      stale:
        project.filmcraft !== null &&
        project.filmcraft.editKey !== sha256Hex(videoRenderKey(project)),
    };
  }

  return {
    status: (id: string): FilmcraftStatus => status(requireProject(id)),

    /**
     * Apre il progetto in FilmCraft. Il `.fcproj` si crea alla prima apertura e si ricrea solo con
     * `rebuild` (le modifiche fatte in FilmCraft andrebbero perse); se l'app è già aperta da
     * Prisma non se ne avvia un'altra.
     */
    async open(id: string, rebuild = false, look?: RenderLook): Promise<VideoProject> {
      let project = requireProject(id);
      if (sessionOf(id) && !rebuild) return project;
      const { exe, cli: cliPath } = await tools();
      const existing = project.filmcraft;
      if (rebuild || !existing || !existsSync(existing.projectPath)) {
        const sessionToClose = sessionOf(id);
        if (sessionToClose) {
          await sessionToClose.client.call('app.quit').catch(() => undefined);
          sessionToClose.client.close();
          sessions.delete(id);
        }
        const projectPath = await buildProject(project, cliPath, look);
        project = {
          ...project,
          filmcraft: {
            projectPath,
            editKey: sha256Hex(videoRenderKey(project)),
            openedAt: now().toISOString(),
            returned: existing?.returned ?? null,
          },
          updatedAt: now().toISOString(),
        };
        deps.store.updateProject(project);
      }
      const port = await freePort();
      const token = randomBytes(32).toString('hex');
      const app = launch(
        exe,
        ['--control', String(port), '--no-recover', project.filmcraft!.projectPath],
        {
          FILMCRAFT_CONTROL_TOKEN: token,
        },
      );
      sessions.set(id, { client: connect(port, token), isAlive: app.isAlive });
      return project;
    },

    /**
     * Fa esportare a FilmCraft il video (H.264 con i sottotitoli impressi) nella cartella degli
     * export e lo registra come «rientrato». Con l'app aperta da Prisma prima salva e poi esporta
     * con l'avanzamento; altrimenti esporta con la CLI l'ultimo salvataggio del progetto.
     */
    async exportReturn(id: string): Promise<VideoProject> {
      if (jobs.has(id)) throw new Error('C’è già un lavoro in corso su questo video');
      const project = requireProject(id);
      if (!project.filmcraft) throw new Error('Prima apri il progetto in FilmCraft');
      const controller = new AbortController();
      jobs.set(id, controller);
      const output = join(deps.exportsRoot, filmcraftFileName(id, now()));
      try {
        await mkdir(dirname(output), { recursive: true });
        deps.emit({ projectId: id, stage: 'filmcraft', percent: 0 });
        const session = sessionOf(id);
        const params = { path: output, format: 'h264', burnCaptions: true, range: 'entire' };
        if (session) {
          await session.client.exec('file.save');
          const started = (await session.client.exec('file.exportMedia', {
            ...params,
            wait: false,
          })) as {
            job?: number;
          };
          if (typeof started?.job !== 'number')
            throw new Error('FilmCraft non ha avviato l’export');
          for (;;) {
            if (controller.signal.aborted) {
              await session.client.exec('jobs.cancel', { job: started.job }).catch(() => undefined);
              throw new Error('Export annullato');
            }
            const job = findJob(await session.client.exec('jobs.list'), started.job);
            if (job?.finished) {
              if (!job.result)
                throw new Error(`FilmCraft non ha esportato il video: ${job.status ?? ''}`);
              break;
            }
            deps.emit({
              projectId: id,
              stage: 'filmcraft',
              percent: job ? Math.min(99, Math.round(job.progress * 100)) : null,
            });
            await sleep(pollMs);
          }
        } else {
          const { cli: cliPath } = await tools();
          deps.emit({ projectId: id, stage: 'filmcraft', percent: null });
          await cli(
            cliPath,
            [
              '--project',
              project.filmcraft.projectPath,
              'exec',
              'file.exportMedia',
              ...Object.entries({ ...params, wait: true }).map(([k, v]) => `${k}=${v}`),
            ],
            controller.signal,
          );
        }
        if (!existsSync(output)) throw new Error('FilmCraft non ha scritto il file');
        const info = await deps.probe(await deps.requireTool('ffprobe'), output);
        const returned = {
          path: output,
          width: info.width,
          height: info.height,
          durationMs: info.durationMs,
          sizeBytes: (await stat(output)).size,
          checksumSha256: await fileSha256(output),
          createdAt: now().toISOString(),
        };
        // Il progetto si rilegge: durante l'export l'editor può aver salvato altre modifiche.
        const current = requireProject(id);
        const updated: VideoProject = {
          ...current,
          filmcraft: { ...(current.filmcraft ?? project.filmcraft), returned },
          updatedAt: now().toISOString(),
        };
        deps.store.updateProject(updated);
        deps.emit({ projectId: id, stage: 'filmcraft', percent: 100 });
        return updated;
      } catch (error) {
        await rm(output, { force: true });
        throw error;
      } finally {
        jobs.delete(id);
      }
    },

    /** «Usa la versione rientrata»: il file di FilmCraft diventa il video finale del progetto. */
    useReturn(id: string): VideoProject {
      const project = requireProject(id);
      const returned = project.filmcraft?.returned;
      if (!returned) throw new Error('Nessun video rientrato da FilmCraft');
      if (!existsSync(returned.path)) throw new Error('Il file rientrato non esiste più');
      const updated: VideoProject = {
        ...project,
        render: {
          path: returned.path,
          format: nearestFormat(returned.width, returned.height),
          width: returned.width,
          height: returned.height,
          durationMs: returned.durationMs,
          sizeBytes: returned.sizeBytes,
          checksumSha256: returned.checksumSha256,
          origin: 'filmcraft',
          renderKey: returned.checksumSha256,
          createdAt: returned.createdAt,
        },
        updatedAt: now().toISOString(),
      };
      deps.store.updateProject(updated);
      return updated;
    },

    cancel(id: string): void {
      jobs.get(id)?.abort();
    },
  };
}

export type FilmcraftService = ReturnType<typeof createFilmcraftService>;
