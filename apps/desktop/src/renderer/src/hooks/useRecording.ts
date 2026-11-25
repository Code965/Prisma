import type { VideoJobProgress, VideoProject } from '@prisma-app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  SessionRecorder,
  mediaErrorMessage,
  openCamera,
  openScreen,
  recordingPlan,
  stopStream,
  type RecordingChoice,
} from '../services/recorder';
import type { ScreenSource } from '../../../main/recording';

export type RecordingPhase = 'pronto' | 'conto' | 'registra' | 'salva';

export interface Devices {
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  screens: ScreenSource[];
}

/** Webcam, microfoni (con i nomi: serve un primo permesso) e schermi/finestre dal main. */
async function loadDevices(): Promise<Devices> {
  // I nomi dei dispositivi arrivano solo dopo un primo permesso: si apre e si chiude subito.
  const probe = await navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null));
  stopStream(probe);
  const all = await navigator.mediaDevices.enumerateDevices();
  const screens = (await window.prisma?.record.sources()) ?? [];
  return {
    cameras: all.filter((d) => d.kind === 'videoinput'),
    mics: all.filter((d) => d.kind === 'audioinput'),
    screens,
  };
}

export function useDevices() {
  const [devices, setDevices] = useState<Devices>({ cameras: [], mics: [], screens: [] });
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    loadDevices()
      .then((found) => {
        if (!active) return;
        setDevices(found);
        setError(null);
      })
      .catch((err: unknown) => active && setError(mediaErrorMessage(err)));
    return () => {
      active = false;
    };
  }, [version]);
  return { devices, error, refresh: () => setVersion((v) => v + 1) };
}

/**
 * Anteprima e registrazione: apre webcam/microfono e schermo scelti, conto alla rovescia, poi
 * registra; «Ferma» salva e restituisce il progetto video creato.
 */
export function useRecording(choice: RecordingChoice) {
  const client = useQueryClient();
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<RecordingPhase>('pronto');
  const [countdown, setCountdown] = useState(3);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<VideoJobProgress | null>(null);
  const session = useRef<SessionRecorder | null>(null);
  const startedAt = useRef(0);

  // Anteprima della webcam e del microfono scelti.
  useEffect(() => {
    let active = true;
    let opened: MediaStream | null = null;
    openCamera(choice)
      .then((stream) => {
        if (!active) return stopStream(stream);
        opened = stream;
        setCamera(stream);
        setError(null);
      })
      .catch((err: unknown) => active && setError(mediaErrorMessage(err)));
    return () => {
      active = false;
      stopStream(opened);
      setCamera(null);
    };
  }, [choice.cameraId, choice.micId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anteprima dello schermo scelto.
  useEffect(() => {
    let active = true;
    let opened: MediaStream | null = null;
    openScreen(choice.screenId)
      .then((stream) => {
        if (!active) return stopStream(stream);
        opened = stream;
        setScreen(stream);
      })
      .catch((err: unknown) => active && setError(mediaErrorMessage(err)));
    return () => {
      active = false;
      stopStream(opened);
      setScreen(null);
    };
  }, [choice.screenId]);

  // Cronometro durante la registrazione.
  useEffect(() => {
    if (phase !== 'registra') return;
    const timer = setInterval(() => setElapsedMs(performance.now() - startedAt.current), 250);
    return () => clearInterval(timer);
  }, [phase]);

  // Avanzamento del salvataggio (conversione con FFmpeg).
  useEffect(() => {
    if (phase !== 'salva' || !window.prisma) return;
    return window.prisma.video.onProgress((update) => {
      if (update.projectId === session.current?.id) setSaving(update);
    });
  }, [phase]);

  const plan = recordingPlan(choice);

  async function start(): Promise<void> {
    if (!plan) return;
    setError(null);
    setPhase('conto');
    for (let n = 3; n > 0; n--) {
      setCountdown(n);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    try {
      session.current = await SessionRecorder.start({ camera, screen, plan });
      startedAt.current = performance.now();
      setElapsedMs(0);
      setPhase('registra');
    } catch (err) {
      setError(mediaErrorMessage(err));
      setPhase('pronto');
    }
  }

  async function stop(): Promise<VideoProject | null> {
    const current = session.current;
    if (!current) return null;
    setPhase('salva');
    try {
      const project = await current.finish();
      void client.invalidateQueries({ queryKey: ['video-projects'] });
      return project;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('pronto');
      return null;
    } finally {
      session.current = null;
      setSaving(null);
    }
  }

  async function cancel(): Promise<void> {
    const current = session.current;
    session.current = null;
    setPhase('pronto');
    await current?.cancel();
  }

  return {
    camera,
    screen,
    phase,
    countdown,
    elapsedMs,
    error,
    saving,
    ready: plan !== null,
    start,
    stop,
    cancel,
  };
}
