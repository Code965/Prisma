import type {
  AutoEditPlan,
  ToolsStatus,
  TranscriptLanguage,
  GenerateShortsResult,
  VideoEdit,
  VideoJobProgress,
  VideoProject,
  VideoTool,
} from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '../services/api/endpoints';
import { autoEditRequest } from '../services/auto-edit';
import { shortsRequest } from '../services/shorts';
import { canUseVideo } from '../services/video';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

type SetToolPath = { tool: VideoTool; path: string | null };

const keys = {
  tools: ['video-tools'] as const,
  projects: ['video-projects'] as const,
};

function bridge() {
  if (!window.prisma?.video || !window.prisma.tools) {
    throw new Error('Il video funziona solo nell’app desktop');
  }
  return window.prisma;
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
  const start = useMutation({
    mutationFn: () => bridge().video.render(projectId),
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
