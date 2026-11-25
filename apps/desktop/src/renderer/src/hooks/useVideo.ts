import {
  enrichOverlays,
  faceIntervalMs,
  type AutoEditPlan,
  type Broll,
  type BrollMedia,
  type Overlay,
  type VideoFormat,
  type ToolsStatus,
  type TranscriptLanguage,
  type GenerateShortsResult,
  type VideoEdit,
  type VideoJobProgress,
  type VideoProject,
  type VideoTool,
} from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../services/api/endpoints';
import { autoEditRequest } from '../services/auto-edit';
import {
  enrichRequest,
  formatOrientation,
  newBroll,
  pickFolderMedia,
  pickStockItem,
  type EnrichSummary,
} from '../services/enrich';
import {
  DEFAULT_VIDEO_TEMPLATE,
  scriptRequest,
  type CreateVideoSource,
} from '../services/create-video';
import { shortsRequest } from '../services/shorts';
import { canUseVideo, mediaUrl } from '../services/video';
import { buildFaceTrack } from '../services/face';
import { FACE_MODEL, analyzeFaces } from '../services/face-detector';
import { useBrand } from './brand';
import { useBrandKit } from './useBrandKit';
import { queryKeys } from './query-client';

type SetToolPath = { tool: VideoTool; path: string | null };

const keys = {
  tools: ['video-tools'] as const,
  music: ['music'] as const,
  broll: ['broll'] as const,
  stock: ['stock'] as const,
  projects: ['video-projects'] as const,
};

/** File della cartella del B-roll (vuoto se non è scelta). */
function brollFolderItems(status: { items: BrollMedia[] } | null): BrollMedia[] {
  return status?.items ?? [];
}

function bridge() {
  if (!window.prisma?.video || !window.prisma.tools) {
    throw new Error('Il video funziona solo nell’app desktop');
  }
  return window.prisma;
}

/** Cartella della musica e i suoi brani (6b). */
export function useMusic() {
  return useQuery({
    queryKey: keys.music,
    queryFn: () => bridge().music.status(),
    enabled: canUseVideo(),
  });
}

/** Scelta della cartella (finestra di sistema) o «Togli». */
export function useSetMusicDir() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'pick' | 'clear') =>
      action === 'pick' ? bridge().music.pick() : bridge().music.clear(),
    onSuccess: (status) => {
      if (status) client.setQueryData(keys.music, status);
    },
  });
}

/** Stato di FFmpeg, ffprobe, whisper.cpp e del modello (rilevati o impostati). */
export function useToolsStatus() {
  return useQuery({
    queryKey: keys.tools,
    queryFn: (): Promise<ToolsStatus> => bridge().tools.status(),
    enabled: canUseVideo(),
    staleTime: 60_000,
  });
}

export function useSetToolPath() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SetToolPath) => bridge().tools.setPath(input),
    onSuccess: (status) => client.setQueryData(keys.tools, status),
  });
}

/** Sceglie il file con la finestra di sistema; se l'utente annulla non cambia nulla. */
export function usePickToolPath() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tool: VideoTool) => bridge().tools.pickPath(tool),
    onSuccess: (status) => {
      if (status) client.setQueryData(keys.tools, status);
    },
  });
}

export function useVideoProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: (): Promise<VideoProject[]> => bridge().video.list(),
    enabled: canUseVideo(),
  });
}

export function useImportVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => bridge().video.import(),
    onSuccess: (project) => {
      if (project) void client.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useRemoveVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bridge().video.remove(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

/** Avanzamento dei lavori (trascrizione, render) di un progetto, dagli eventi del main. */
function useJobProgress(projectId: string) {
  const [progress, setProgress] = useState<VideoJobProgress | null>(null);
  useEffect(() => {
    if (!canUseVideo()) return;
    return bridge().video.onProgress((update) => {
      if (update.projectId === projectId) setProgress(update);
    });
  }, [projectId]);
  return [progress, setProgress] as const;
}

function useReplaceProject() {
  const client = useQueryClient();
  return (updated: VideoProject) =>
    client.setQueryData<VideoProject[]>(keys.projects, (list) =>
      list?.map((p) => (p.id === updated.id ? updated : p)),
    );
}

/**
 * Trascrizione di un progetto: avvio, annullamento e avanzamento in tempo reale (eventi dal
 * main). A lavoro finito il progetto aggiornato sostituisce quello in elenco.
 */
export function useTranscription(projectId: string) {
  const [progress, setProgress] = useJobProgress(projectId);
  const replace = useReplaceProject();
  const start = useMutation({
    mutationFn: (language: TranscriptLanguage) => bridge().video.transcribe(projectId, language),
    onMutate: () => setProgress(null),
    onSuccess: replace,
    onSettled: () => setProgress(null),
  });
  return {
    start,
    progress: start.isPending ? progress : null,
    cancel: () => void bridge().video.cancel(projectId),
  };
}

/** Esportazione del video montato con FFmpeg, con avanzamento e annullamento. */
export function useRenderVideo(projectId: string) {
  const [progress, setProgress] = useJobProgress(projectId);
  const replace = useReplaceProject();
  const client = useQueryClient();
  // Le schede di testo si disegnano con il brand kit (6d).
  const kit = useBrandKit().data;
  const start = useMutation({
    mutationFn: () =>
      bridge().video.render(projectId, kit ? { kit, template: DEFAULT_VIDEO_TEMPLATE } : undefined),
    onMutate: () => setProgress(null),
    onSuccess: (updated) => {
      replace(updated);
      void client.invalidateQueries({ queryKey: ['video-render-status', projectId] });
    },
    onSettled: () => setProgress(null),
  });
  return {
    start,
    progress: start.isPending ? progress : null,
    cancel: () => void bridge().video.cancel(projectId),
  };
}

/** Il video esportato corrisponde ancora alle modifiche (lo calcola il main). */
export function useRenderStatus(project: VideoProject) {
  return useQuery({
    queryKey: ['video-render-status', project.id, project.updatedAt],
    queryFn: () => bridge().video.renderStatus(project.id),
    enabled: canUseVideo() && project.render !== null,
  });
}

/** Salva le modifiche dell'editor; il progetto restituito aggiorna l'elenco in cache. */
export function useSaveVideoEdit(projectId: string) {
  const replace = useReplaceProject();
  return useMutation({
    mutationFn: (edit: VideoEdit) => bridge().video.saveEdit(projectId, edit),
    onSuccess: replace,
  });
}

/**
 * «Genera Short da video lungo»: il server sceglie i momenti con l'LLM e crea le bozze nello
 * Studio, poi il main crea un progetto video tagliato per ciascuno.
 */
export function useGenerateShorts(project: VideoProject) {
  const { brand } = useBrand();
  const client = useQueryClient();
  const request = brand ? shortsRequest(project, brand.id) : null;
  const mutation = useMutation({
    mutationFn: async (): Promise<GenerateShortsResult> => {
      if (!request) throw new Error('Prima trascrivi il video');
      const result = await api.generateShorts(request);
      for (const short of result.shorts) {
        await bridge().video.createShort({
          parentId: project.id,
          contentId: short.content.id,
          title: short.content.title,
          startMs: short.startMs,
          endMs: short.endMs,
        });
      }
      return result;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.projects });
      if (brand) void client.invalidateQueries({ queryKey: queryKeys.contents(brand.id) });
    },
  });
  return { ...mutation, available: request !== null };
}

/**
 * «Monta con l'AI»: il server chiede al modello la proposta di montaggio; l'editor la applica
 * alle modifiche (`applyAutoEdit`) e l'autore la rivede prima dell'export.
 */
export function useAutoEdit(project: VideoProject) {
  const { brand } = useBrand();
  const request = brand ? autoEditRequest(project, brand.id) : null;
  const mutation = useMutation({
    mutationFn: async (): Promise<AutoEditPlan> => {
      if (!request) throw new Error('Prima trascrivi il video');
      return api.autoEditPlan(request);
    },
  });
  return { ...mutation, available: request !== null };
}

/**
 * «Crea video dall'idea»: copione dal server, poi voce, slide e montaggio nel main. Restituisce
 * il progetto video creato, da aprire nell'editor.
 */
export function useCreateVideo() {
  const { brand } = useBrand();
  const kit = useBrandKit().data;
  const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useJobProgress(jobId ?? '');
  const mutation = useMutation({
    mutationFn: async (source: CreateVideoSource): Promise<VideoProject> => {
      if (!kit) throw new Error('Brand kit non ancora caricato');
      const video = bridge().video;
      const id = crypto.randomUUID();
      setJobId(id);
      setProgress(null);
      const script = await api.videoScript(scriptRequest(source));
      return video.generate({
        jobId: id,
        script,
        source,
        template: DEFAULT_VIDEO_TEMPLATE,
        kit,
        initials: brand?.initials ?? '',
      });
    },
    onSuccess: (project) =>
      client.setQueryData<VideoProject[]>(keys.projects, (list) => [project, ...(list ?? [])]),
    onSettled: () => {
      setJobId(null);
      void client.invalidateQueries({ queryKey: keys.projects });
    },
  });
  return {
    ...mutation,
    progress: mutation.isPending ? progress : null,
    cancel: () => {
      if (jobId) void bridge().video.cancel(jobId);
    },
  };
}

/**
 * «Segui il volto» (6e): MediaPipe cerca il volto nel video (nel renderer, senza rete), poi la
 * traccia si salva nel progetto. Annullabile, con l'avanzamento.
 */
export function useFaceAnalysis(project: VideoProject) {
  const replace = useReplaceProject();
  const [percent, setPercent] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: async (): Promise<VideoProject> => {
      const abort = new AbortController();
      controller.current = abort;
      setPercent(0);
      const durationMs = project.source.durationMs;
      const samples = await analyzeFaces({
        videoUrl: mediaUrl(project.id),
        durationMs,
        intervalMs: faceIntervalMs(durationMs),
        onProgress: setPercent,
        signal: abort.signal,
      });
      return bridge().video.saveFaces(project.id, buildFaceTrack(samples, durationMs, FACE_MODEL));
    },
    onSuccess: replace,
    onSettled: () => {
      controller.current = null;
      setPercent(null);
    },
  });
  return { ...mutation, percent, cancel: () => controller.current?.abort() };
}

/** Cartella del B-roll e i suoi file (6d). */
export function useBrollFolder() {
  return useQuery({
    queryKey: keys.broll,
    queryFn: () => bridge().broll.status(),
    enabled: canUseVideo(),
  });
}

export function useSetBrollDir() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'pick' | 'clear') =>
      action === 'pick' ? bridge().broll.pick() : bridge().broll.clear(),
    onSuccess: (status) => {
      if (status) client.setQueryData(keys.broll, status);
    },
  });
}

/** Chiave di Pixabay (salvata cifrata sul server). */
export function useStockStatus() {
  return useQuery({ queryKey: keys.stock, queryFn: api.stockStatus });
}

export function useSetStockKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string | null) =>
      apiKey ? api.saveStockKey(apiKey) : api.removeStockKey(),
    onSuccess: (status) => client.setQueryData(keys.stock, status),
  });
}

/**
 * «Aggiungi B-roll e testi»: proposta dell'AI, poi per ogni ricerca un file della cartella o,
 * se c'è la chiave, un risultato di Pixabay scaricato nella cache. Restituisce schede e B-roll
 * da mettere nelle modifiche (l'editor li applica con «Annulla» a disposizione).
 */
export function useEnrich(project: VideoProject) {
  const { brand } = useBrand();
  const request = brand ? enrichRequest(project, brand.id) : null;
  const mutation = useMutation({
    mutationFn: async (
      format: VideoFormat,
    ): Promise<{ overlays: Overlay[]; broll: Broll[]; summary: EnrichSummary }> => {
      if (!request) throw new Error('Prima trascrivi il video');
      const plan = await api.enrichPlan(request);
      const { overlays, brollRequests } = enrichOverlays(request.segments, plan);
      const folder = brollFolderItems(await bridge().broll.status());
      const stockOn = brollRequests.length > 0 && (await api.stockStatus()).configured;
      const summary: EnrichSummary = {
        overlays: overlays.length,
        fromFolder: 0,
        fromPixabay: 0,
        missing: 0,
        stockOff: !stockOn,
      };
      const broll: Broll[] = [];
      for (const [index, wanted] of brollRequests.entries()) {
        const needMs = wanted.endMs - wanted.startMs;
        const local = pickFolderMedia(folder, wanted.query, needMs);
        if (local) {
          broll.push(newBroll(wanted, local, index));
          summary.fromFolder++;
          continue;
        }
        if (!stockOn) {
          summary.missing++;
          continue;
        }
        const orientation = formatOrientation(format);
        const videos = await api.stockSearch({ q: wanted.query, kind: 'video', orientation });
        const best =
          pickStockItem(videos.items, [], needMs, format) ??
          pickStockItem(
            [],
            (await api.stockSearch({ q: wanted.query, kind: 'image', orientation })).items,
            needMs,
            format,
          );
        if (!best) {
          summary.missing++;
          continue;
        }
        broll.push(newBroll(wanted, await bridge().broll.download(best), index));
        summary.fromPixabay++;
      }
      return { overlays, broll, summary };
    },
  });
  return { ...mutation, available: request !== null };
}

/** FilmCraft aperto da Prisma e progetto superato; si ricontrolla spesso perché l'app si può chiudere. */
export function useFilmcraftStatus(project: VideoProject) {
  return useQuery({
    queryKey: ['filmcraft-status', project.id, project.updatedAt],
    queryFn: () => bridge().filmcraft.status(project.id),
    enabled: canUseVideo() && project.filmcraft !== null,
    refetchInterval: 5000,
  });
}

/** «Apri in FilmCraft», export con rientro e «Usa la versione rientrata». */
export function useFilmcraft(projectId: string) {
  const [progress, setProgress] = useJobProgress(projectId);
  const replace = useReplaceProject();
  const client = useQueryClient();
  const refresh = (updated: VideoProject) => {
    replace(updated);
    void client.invalidateQueries({ queryKey: ['filmcraft-status', projectId] });
    void client.invalidateQueries({ queryKey: ['video-render-status', projectId] });
  };
  const open = useMutation({
    mutationFn: (rebuild: boolean) => bridge().filmcraft.open({ projectId, rebuild }),
    onSuccess: refresh,
  });
  const exportReturn = useMutation({
    mutationFn: () => bridge().filmcraft.exportReturn(projectId),
    onMutate: () => setProgress(null),
    onSuccess: refresh,
    onSettled: () => setProgress(null),
  });
  const useReturn = useMutation({
    mutationFn: () => bridge().filmcraft.useReturn(projectId),
    onSuccess: refresh,
  });
  return {
    open,
    exportReturn,
    useReturn,
    progress: exportReturn.isPending ? progress : null,
    cancel: () => void bridge().video.cancel(projectId),
  };
}
