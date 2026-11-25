/**
 * Registrazione nell'app (fase 6f), lato renderer: webcam (con il microfono) e schermo in due
 * MediaRecorder separati; i pezzi (ogni secondo) vanno al main in ordine e finiscono su disco,
 * così una registrazione lunga non resta in memoria. La parte pura è testata; il resto usa le API
 * del browser.
 */

export type RecordingTrack = 'camera' | 'screen';

export interface RecordingChoice {
  cameraId: string | null;
  micId: string | null;
  /** Schermo o finestra (id di desktopCapturer); null = senza schermo. */
  screenId: string | null;
}

/** Codec preferiti: H.264 (spesso in hardware, leggero per la CPU), poi VP8. */
export const MIME_CANDIDATES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export function pickMimeType(isSupported: (mime: string) => boolean): string {
  return MIME_CANDIDATES.find((mime) => isSupported(mime)) ?? 'video/webm';
}

/** Tracce da registrare e dove va il microfono (sulla webcam se c'è, altrimenti sullo schermo). */
export function recordingPlan(choice: RecordingChoice): {
  tracks: RecordingTrack[];
  audioTrack: RecordingTrack | null;
} | null {
  const tracks: RecordingTrack[] = [];
  if (choice.cameraId) tracks.push('camera');
  if (choice.screenId) tracks.push('screen');
  if (tracks.length === 0) return null;
  const audioTrack = choice.micId ? (choice.cameraId ? 'camera' : 'screen') : null;
  return { tracks, audioTrack };
}

/** «02:15» (o «1:02:15»). */
export function timerLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}

/** Messaggio comprensibile per gli errori di getUserMedia/getDisplayMedia. */
export function mediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Accesso negato: controlla in Impostazioni di Windows › Privacy che le app possano usare webcam e microfono';
    case 'NotFoundError':
      return 'Dispositivo non trovato: è collegato?';
    case 'NotReadableError':
      return 'Il dispositivo è usato da un’altra app: chiudila e riprova';
    case 'OverconstrainedError':
      return 'Il dispositivo non supporta la qualità richiesta';
    default:
      return error instanceof Error ? error.message : 'Errore del dispositivo';
  }
}

/** Webcam e microfono per l'anteprima e la registrazione (1080p 30 fps). */
export function openCamera(choice: RecordingChoice): Promise<MediaStream | null> {
  if (!choice.cameraId && !choice.micId) return Promise.resolve(null);
  return navigator.mediaDevices.getUserMedia({
    video: choice.cameraId
      ? {
          deviceId: { exact: choice.cameraId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        }
      : false,
    audio: choice.micId
      ? { deviceId: { exact: choice.micId }, echoCancellation: true, noiseSuppression: true }
      : false,
  });
}

/** Schermo o finestra scelti (il main li passa a getDisplayMedia), al massimo 1080p 30 fps. */
export async function openScreen(screenId: string | null): Promise<MediaStream | null> {
  if (!screenId) return null;
  await window.prisma!.record.choose(screenId);
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } },
    audio: false,
  });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Una registrazione in corso: due MediaRecorder e la coda dei pezzi verso il main. */
export class SessionRecorder {
  private recorders: Partial<Record<RecordingTrack, MediaRecorder>> = {};
  private pending: Partial<Record<RecordingTrack, Promise<void>>> = {};
  private stopped: Promise<void>[] = [];
  private failure: unknown = null;
  readonly startedAt: Partial<Record<RecordingTrack, number>> = {};

  private constructor(readonly id: string) {}

  static async start(options: {
    camera: MediaStream | null;
    screen: MediaStream | null;
    plan: { tracks: RecordingTrack[]; audioTrack: RecordingTrack | null };
  }): Promise<SessionRecorder> {
    const bridge = window.prisma!.record;
    const id = await bridge.begin(options.plan.tracks, options.plan.audioTrack);
    const session = new SessionRecorder(id);
    const mimeType = pickMimeType((mime) => MediaRecorder.isTypeSupported(mime));
    for (const track of options.plan.tracks) {
      let stream = track === 'camera' ? options.camera! : options.screen!;
      // Senza webcam il microfono va sulla traccia dello schermo.
      if (track === 'screen' && options.plan.audioTrack === 'screen' && options.camera) {
        stream = new MediaStream([...stream.getVideoTracks(), ...options.camera.getAudioTracks()]);
      }
      if (track === 'camera' && !options.camera?.getVideoTracks().length) continue;
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: track === 'camera' ? 8_000_000 : 6_000_000,
        audioBitsPerSecond: 160_000,
      });
      session.pending[track] = Promise.resolve();
      recorder.onstart = () => {
        session.startedAt[track] = performance.now();
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        // In ordine: ogni pezzo parte dopo il precedente.
        session.pending[track] = session.pending[track]!.then(async () => {
          const data = new Uint8Array(await event.data.arrayBuffer());
          await bridge.chunk(id, track, data);
        }).catch((error: unknown) => {
          session.failure ??= error;
        });
      };
      session.stopped.push(new Promise((resolve) => (recorder.onstop = () => resolve())));
      session.recorders[track] = recorder;
    }
    for (const recorder of Object.values(session.recorders)) recorder.start(1000);
    return session;
  }

  /** Ferma, aspetta gli ultimi pezzi e fa nascere il progetto video. */
  async finish() {
    for (const recorder of Object.values(this.recorders)) {
      if (recorder.state !== 'inactive') recorder.stop();
    }
    await Promise.all(this.stopped);
    await Promise.all(Object.values(this.pending));
    if (this.failure) throw this.failure;
    return window.prisma!.record.finish(this.id, this.startedAt);
  }

  async cancel(): Promise<void> {
    for (const recorder of Object.values(this.recorders)) {
      if (recorder.state !== 'inactive') recorder.stop();
    }
    await Promise.all(this.stopped);
    await Promise.all(Object.values(this.pending));
    await window.prisma!.record.cancel(this.id);
  }
}
