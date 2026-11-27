import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';

const trendsKey = (brandId: number) => ['brands', brandId, 'trends'] as const;

/** Parole del radar, ultimo aggiornamento e cosa impedisce di aggiornare. */
export function useTrends() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: trendsKey(brand?.id ?? 0),
    queryFn: () => api.trends(brand!.id),
    enabled: Boolean(brand),
  });
}

export function useSaveTrendKeywords() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (keywords: string[]) => api.saveTrendKeywords(brand!.id, keywords),
    onSuccess: () => client.invalidateQueries({ queryKey: trendsKey(brand!.id) }),
  });
}

/** «Aggiorna»: raccolta dalle fonti e una chiamata all'AI (decine di secondi). */
export function useRefreshTrends() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshTrends(brand!.id),
    onSuccess: () => client.invalidateQueries({ queryKey: trendsKey(brand!.id) }),
  });
}
