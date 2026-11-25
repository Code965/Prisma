import { FaceDetector } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { FaceSample } from '@prisma-app/shared';
import modelUrl from '../assets/models/blaze_face_short_range.tflite?url';
import { bestFace, fetchableUrl, type Detection } from './face';

/**
 * Riconoscimento dei volti con MediaPipe (fase 6e, `@mediapipe/tasks-vision`, Apache-2.0, modello
 * BlazeFace short range): gira nel renderer, sulla CPU, senza rete. Dalla build il renderer è un
 * `file://` dove `fetch` non funziona: WebAssembly e modello passano dal protocollo `prisma-app`.
 */

export const FACE_MODEL = 'blaze_face_short_range';

async function createDetector(): Promise<FaceDetector> {
  return FaceDetector.createFromOptions(
    {
      // Lo script si carica con un <script>: da file:// va bene così.
      wasmLoaderPath: new URL(wasmLoaderUrl, location.href).href,
      wasmBinaryPath: fetchableUrl(wasmBinaryUrl),
    },
    {
      baseOptions: { modelAssetPath: fetchableUrl(modelUrl), delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    },
  );
}

const ANALYSIS_WIDTH = 320;
/** Il video scorre veloce e si analizza il fotogramma appena decodificato: molto più rapido dei salti. */
const PLAYBACK_RATE = 8;

/**
 * Scorre il video (muto, a velocità 8×) e cerca il volto circa ogni `intervalMs`, con il tempo vero
 * del fotogramma. Annullabile; l'avanzamento va da 0 a 100.
 */
export async function analyzeFaces(options: {
  videoUrl: string;
  durationMs: number;
  intervalMs: number;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
}): Promise<FaceSample[]> {
  const detector = await createDetector();
  const video = document.createElement('video');
  video.muted = true;
  // Con CORS il canvas resta leggibile: MediaPipe deve leggerne i pixel.
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.preload = 'auto';
  video.src = options.videoUrl;
  const samples: FaceSample[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Il video non si apre per l’analisi'));
    });
    const width = ANALYSIS_WIDTH;
    const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    let nextMs = 0;

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        video.pause();
        reject(new Error('Analisi annullata'));
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (options.signal.aborted) return;
        const ms = Math.round(meta.mediaTime * 1000);
        if (ms >= nextMs) {
          let result: ReturnType<FaceDetector['detect']>;
          try {
            context.drawImage(video, 0, 0, width, height);
            result = detector.detect(canvas);
          } catch (error) {
            video.pause();
            reject(new Error('Analisi dei volti non riuscita', { cause: error }));
            return;
          }
          const detections: Detection[] = result.detections.flatMap((d) =>
            d.boundingBox
              ? [
                  {
                    box: {
                      x: d.boundingBox.originX,
                      y: d.boundingBox.originY,
                      width: d.boundingBox.width,
                      height: d.boundingBox.height,
                    },
                    score: d.categories[0]?.score ?? 0,
                  },
                ]
              : [],
          );
          samples.push({ ms, ...bestFace(detections, width, height) });
          nextMs = ms + options.intervalMs;
          options.onProgress(Math.min(99, Math.round((ms / options.durationMs) * 100)));
        }
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      video.onended = () => {
        options.signal.removeEventListener('abort', onAbort);
        resolve();
      };
      video.requestVideoFrameCallback(onFrame);
      video.playbackRate = PLAYBACK_RATE;
      video.play().catch(reject);
    });
    options.onProgress(100);
    return samples;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    detector.close();
  }
}
