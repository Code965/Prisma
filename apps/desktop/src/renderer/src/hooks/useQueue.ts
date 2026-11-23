import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

/** Controlli dei requisiti dei post in coda, calcolati dal server con gli adapter veri. */
export function useQueueChecks() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.checks(brand?.id ?? 0),
    queryFn: () => api.publicationChecks(brand!.id),
    enabled: Boolean(brand),
  });
}

/** Dopo ogni azione sulla coda si ricaricano pubblicazioni, controlli e bozze. */
function useQueueAction(action: (id: number) => Promise<unknown>) {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSettled: () => {
      if (!brand) return;
      void client.invalidateQueries({ queryKey: queryKeys.publications(brand.id) });
      void client.invalidateQueries({ queryKey: queryKeys.checks(brand.id) });
      void client.invalidateQueries({ queryKey: queryKeys.contents(brand.id) });
    },
  });
}

/** "Pubblica ora": la pubblicazione resta approvata, lo scheduler la prende al prossimo giro. */
export const usePublishNow = () => useQueueAction(api.publishNow);
/** "Annulla": esce dalla coda e la bozza torna approvata. */
export const useCancelPublication = () => useQueueAction(api.cancelPublication);
/** "Riprova" dopo un errore. */
export const useRetryPublication = () => useQueueAction(api.retryPublication);
