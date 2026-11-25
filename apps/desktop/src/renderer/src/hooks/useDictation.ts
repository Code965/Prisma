import { useEffect, useRef, useState } from 'react';
import { mediaErrorMessage, stopStream } from '../services/recorder';
import {
  DICTATION_MAX_MS,
  NOTHING_HEARD,
  canDictate,
  dictationError,
  pickAudioMime,
  type DictationPhase,
} from '../services/dictation';

/**
 * Microfono → MediaRecorder → trascrizione nel main. `onText` riceve il testo dettato.
 * Un secondo clic ferma l'ascolto; dopo 5 minuti si ferma da solo.
 */
export function useDictation(onText: (text: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>('pronto');
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  // Uscendo dalla schermata si spegne il microfono e si annulla la trascrizione.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      const active = recorder.current;
      recorder.current = null;
      if (active && active.state !== 'inactive') {
        active.ondataavailable = null;
        active.onstop = null;
        active.stop();
        stopStream(active.stream);
      }
      void window.prisma?.dictation.cancel();
    },
    [],
  );

  async function transcribe(chunks: Blob[], mimeType: string) {
    setPhase('trascrivo');
    try {
      const audio = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
      if (audio.byteLength === 0) throw new Error(NOTHING_HEARD);
      const result = await window.prisma!.dictation.transcribe(audio, 'auto');
      if (!result.text) throw new Error(NOTHING_HEARD);
      onTextRef.current(result.text);
    } catch (err) {
      setError(dictationError(err));
    } finally {
      setPhase('pronto');
    }
  }

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setError(mediaErrorMessage(err));
      return;
    }
    const mimeType = pickAudioMime((mime) => MediaRecorder.isTypeSupported(mime));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    rec.onstop = () => {
      stopStream(stream);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      recorder.current = null;
      setStartedAt(null);
      void transcribe(chunks, rec.mimeType || 'audio/webm');
    };
    recorder.current = rec;
    rec.start(1000);
    setStartedAt(Date.now());
    setPhase('ascolto');
    timer.current = window.setTimeout(() => stop(), DICTATION_MAX_MS);
  }

  function stop() {
    const active = recorder.current;
    if (active && active.state !== 'inactive') active.stop();
  }

  return {
    available: canDictate(),
    phase,
    error,
    startedAt,
    toggle: () => (phase === 'ascolto' ? stop() : phase === 'pronto' ? void start() : undefined),
    clearError: () => setError(null),
  };
}
