import {
  DEFAULT_VIDEO_EDIT,
  type VideoJobProgress,
  type VideoProject,
  type VideoSource,
} from '@prisma-app/shared';
import { desktopCapturer, session, type DesktopCapturerSource, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessRunner } from './video/process.js';
import type { LocalStore } from './video/store.js';
import { ffmpegProgress } from './video/whisper.js';

/**
 * Registrazione nell'app (fase 6f): webcam (con il microfono) e schermo, due file separati e
 * sincronizzati. Il renderer registra con MediaRecorder e manda i pezzi qui man mano; a fine
 * registrazione FFmpeg li converte in MP4 (i WebM di MediaRecorder non hanno durata né indice) e
 * nasce un progetto video: la webcam è il sorgente, lo schermo la seconda traccia.
 */

export const RECORDING_TRACKS = ['camera', 'screen'] as const;
export type RecordingTrack = (typeof RECORDING_TRACKS)[number];

/** Permessi chiesti dalle pagine dell'app: solo questi, tutto il resto è negato. */
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'clipboard-sanitized-write',
  'fullscreen',
]);

export function isAllowedPermission(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

/** Argomenti di FFmpeg per convertire una traccia: H.264 a 30 fps, AAC per la webcam. */
export function convertArgs(
  input: string,
  output: string,
  track: RecordingTrack,
  hasAudio: boolean,
): string[] {
  return [
    '-y',
    '-nostdin',
    '-i',
    input,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    track === 'camera' ? '20' : '22',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    output,
  ];
}

/** «Registrazione del 25 nov, 14:03» (ora italiana). */
export function recordingTitle(at: Date): string {
  const day = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
  }).format(at);
  const time = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return `Registrazione del ${day}, ${time}`;
}

interface Session6f {
  dir: string;
  streams: Partial<Record<RecordingTrack, WriteStream>>;
  /** Quale traccia porta il microfono. */
  audioTrack: RecordingTrack | null;
}

export interface RecordingDeps {
  store: LocalStore;
  rootDir: string;
  requireTool: (tool: 'ffmpeg' | 'ffprobe') => Promise<string>;
  run: ProcessRunner;
  probe: (ffprobe: string, path: string) => Promise<VideoSource>;
  emit: (progress: VideoJobProgress) => void;
  now?: () => Date;
}

export function createRecordingService(deps: RecordingDeps) {
  const sessions = new Map<string, Session6f>();
  let chosenSource: string | null = null;

  /** Schermi e finestre da registrare, con una miniatura. */
  async function sources(): Promise<ScreenSource[]> {
    const list = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    return list.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.toDataURL(),
    }));
  }

  /**
   * `getDisplayMedia` del renderer riceve la sorgente scelta prima nella schermata «Registra»
   * (su Windows Electron non ha un selettore di sistema). Permessi: solo webcam, microfono,
   * schermo, appunti e schermo intero.
   */
  function attach(target: Session = session.defaultSession): void {
    target.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(isAllowedPermission(permission)),
    );
    target.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission));
    target.setDisplayMediaRequestHandler((_request, callback) => {
      void (async () => {
        const list = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const source: DesktopCapturerSource | undefined = list.find((s) => s.id === chosenSource);
        // Senza sorgente scelta la richiesta si rifiuta (getDisplayMedia dà errore).
        callback(source ? { video: source } : {});
      })();
    });
  }

  async function begin(
    tracks: RecordingTrack[],
    audioTrack: RecordingTrack | null,
  ): Promise<string> {
    const id = randomUUID();
    const dir = join(deps.rootDir, id);
    await mkdir(dir, { recursive: true });
    const streams: Session6f['streams'] = {};
    for (const track of tracks) streams[track] = createWriteStream(join(dir, `${track}.webm`));
    sessions.set(id, { dir, streams, audioTrack });
    return id;
  }

  function chunk(id: string, track: RecordingTrack, data: Uint8Array): void {
    const stream = sessions.get(id)?.streams[track];
    if (!stream) throw new Error('Registrazione non trovata');
    stream.write(Buffer.from(data));
  }

  async function closeStreams(current: Session6f): Promise<void> {
    await Promise.all(
      Object.values(current.streams).map(
        (stream) => new Promise<void>((resolve) => stream!.end(() => resolve())),
      ),
    );
  }

  async function finish(
    id: string,
    startedAt: Partial<Record<RecordingTrack, number>>,
  ): Promise<VideoProject> {
    const current = sessions.get(id);
    if (!current) throw new Error('Registrazione non trovata');
    await closeStreams(current);
    sessions.delete(id);
    try {
      const [ffmpeg, ffprobe] = await Promise.all([
        deps.requireTool('ffmpeg'),
        deps.requireTool('ffprobe'),
      ]);
      const tracks = Object.keys(current.streams) as RecordingTrack[];
      const converted: Partial<Record<RecordingTrack, VideoSource>> = {};
      for (const [index, track] of tracks.entries()) {
        const input = join(current.dir, `${track}.webm`);
        const output = join(current.dir, track === 'camera' ? 'webcam.mp4' : 'schermo.mp4');
        const hasAudio = current.audioTrack === track;
        deps.emit({
          projectId: id,
          stage: 'registrazione',
          percent: Math.round((index / tracks.length) * 100),
        });
        const result = await deps.run(ffmpeg, convertArgs(input, output, track, hasAudio), {
          onLine: (line) => {
            // La durata non si conosce prima: l'avanzamento resta per traccia.
            if (ffmpegProgress(line, 1) !== null)
              deps.emit({ projectId: id, stage: 'registrazione', percent: null });
          },
        });
        if (result.code !== 0) {
          const last = result.stderrTail.trim().split('\n').filter(Boolean).pop() ?? 'errore';
          throw new Error(`FFmpeg non ha salvato la registrazione: ${last.slice(0, 300)}`);
        }
        await rm(input, { force: true });
        converted[track] = await deps.probe(ffprobe, output);
      }
      const main = converted.camera ?? converted.screen;
      if (!main) throw new Error('Registrazione vuota');
      const screen = converted.camera && converted.screen ? converted.screen : null;
      const at = deps.now?.() ?? new Date();
      const project = deps.store.createProject(main, recordingTitle(at), {
        screen: screen
          ? {
              path: screen.path,
              fileName: screen.fileName,
              width: screen.width,
              height: screen.height,
              durationMs: screen.durationMs,
              offsetMs: Math.round((startedAt.screen ?? 0) - (startedAt.camera ?? 0)),
            }
          : null,
        recording: {
          recordedAt: at.toISOString(),
          camera: Boolean(converted.camera),
          screen: Boolean(converted.screen),
        },
        // Con webcam e schermo si parte dal layout diviso (9:16 è il formato predefinito).
        ...(screen ? { edit: { ...DEFAULT_VIDEO_EDIT, layout: 'split' as const } } : {}),
      });
      deps.emit({ projectId: id, stage: 'registrazione', percent: 100 });
      return project;
    } catch (error) {
      await rm(current.dir, { recursive: true, force: true });
      throw error;
    }
  }

  return {
    sources,
    chooseSource(id: string | null): void {
      chosenSource = id;
    },
    attach,
    begin,
    chunk,
    finish,
    async cancel(id: string): Promise<void> {
      const current = sessions.get(id);
      if (!current) return;
      sessions.delete(id);
      await closeStreams(current);
      await rm(current.dir, { recursive: true, force: true });
    },
  };
}

export type RecordingService = ReturnType<typeof createRecordingService>;
