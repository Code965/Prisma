import type { Inspiration, InspireRequest, Platform } from '@prisma-app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { inspiredIdeaInput } from '../services/inspire';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

/** «Ispirati»: meccanismo e proposta dell'AI, senza salvare nulla (decine di secondi). */
export function useInspire() {
  const { brand } = useBrand();
  return useMutation({
    mutationFn: (request: InspireRequest) => api.inspire(brand!.id, request),
  });
}

/**
 * Salva l'idea con il riferimento al post d'origine e, se richiesto, genera le bozze con lo
 * stesso flusso delle Idee (restano in bozza fino all'approvazione).
 */
export function useCreateInspiredIdea() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (value: {
      proposal: Inspiration;
      text: string;
      platforms: Platform[];
      drafts: boolean;
    }) => {
      const idea = await api.createIdea(
        brand!.id,
        inspiredIdeaInput(value.proposal, value.text, value.platforms),
      );
      const content = value.drafts
        ? await api.generateContent({ ideaId: idea.id, platforms: value.platforms })
        : null;
      if (content) client.setQueryData(queryKeys.content(content.id), content);
      return { idea, content };
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.ideas(brand!.id) }),
  });
}
