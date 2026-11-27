import type { CompetitorInput, CompetitorPostInput } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';

const competitorsKey = (brandId: number) => ['brands', brandId, 'competitors'] as const;

/** Concorrenti con post e statistiche, le proprie per confronto e l'ultima analisi dell'AI. */
export function useCompetitors() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: competitorsKey(brand?.id ?? 0),
    queryFn: () => api.competitors(brand!.id),
    enabled: Boolean(brand),
  });
}

/** Mutazione che alla fine ricarica lo stato dei concorrenti. */
function useCompetitorMutation<T>(fn: (brandId: number, value: T) => Promise<unknown>) {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (value: T) => fn(brand!.id, value),
    onSettled: () => client.invalidateQueries({ queryKey: competitorsKey(brand!.id) }),
  });
}

export const useAddCompetitor = () =>
  useCompetitorMutation((brandId, input: CompetitorInput) => api.createCompetitor(brandId, input));
export const useDeleteCompetitor = () =>
  useCompetitorMutation((_brandId, id: number) => api.deleteCompetitor(id));
export const useRefreshCompetitor = () =>
  useCompetitorMutation((_brandId, id: number) => api.refreshCompetitor(id));
export const useAddCompetitorPost = () =>
  useCompetitorMutation((_brandId, value: { id: number; input: CompetitorPostInput }) =>
    api.addCompetitorPost(value.id, value.input),
  );
export const useDeleteCompetitorPost = () =>
  useCompetitorMutation((_brandId, id: number) => api.deleteCompetitorPost(id));
/** Analisi dell'AI (decine di secondi). */
export const useAnalyzeCompetitors = () =>
  useCompetitorMutation((brandId, _value: void) => api.analyzeCompetitors(brandId));
