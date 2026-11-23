import type { Idea, IdeaUpdate, Platform } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

export function useTags() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.tags(brand?.id ?? 0),
    queryFn: () => api.tags(brand!.id),
    enabled: Boolean(brand),
  });
}

export function useIdeas() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.ideas(brand?.id ?? 0),
    queryFn: () => api.ideas(brand!.id),
    enabled: Boolean(brand),
  });
}

export function useCreateIdea() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; tagIds: number[] }) =>
      api.createIdea(brand!.id, { ...input, source: 'scritta' }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.ideas(brand!.id) }),
  });
}

/**
 * Aggiornamento ottimistico: la scelta delle piattaforme si vede subito e, se il server
 * rifiuta, la lista torna com'era.
 */
export function useUpdateIdea() {
  const { brand } = useBrand();
  const client = useQueryClient();
  const key = queryKeys.ideas(brand?.id ?? 0);

  return useMutation({
    mutationFn: ({ id, update }: { id: number; update: IdeaUpdate }) => api.updateIdea(id, update),
    onMutate: async ({ id, update }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Idea[]>(key);
      client.setQueryData<Idea[]>(key, (ideas) =>
        ideas?.map((idea) =>
          idea.id === id && update.targetPlatforms
            ? { ...idea, targetPlatforms: update.targetPlatforms as Platform[] }
            : idea,
        ),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

/** Elimina un'idea: sparisce subito dalla lista e torna se il server rifiuta. */
export function useDeleteIdea() {
  const { brand } = useBrand();
  const client = useQueryClient();
  const key = queryKeys.ideas(brand?.id ?? 0);

  return useMutation({
    mutationFn: (id: number) => api.deleteIdea(id),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Idea[]>(key);
      client.setQueryData<Idea[]>(key, (ideas) => ideas?.filter((idea) => idea.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

/** "Genera contenuti": l'LLM crea le bozze; l'idea passa a "in lavorazione". */
export function useGenerateContent() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { ideaId: number; platforms: Platform[] }) => api.generateContent(input),
    onSuccess: (content) => {
      client.setQueryData(queryKeys.content(content.id), content);
      return client.invalidateQueries({ queryKey: queryKeys.ideas(brand!.id) });
    },
  });
}
