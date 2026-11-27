import type { Platform, PlanIdeasInput, PlanState } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

const planKey = (brandId: number, month: string) => ['brands', brandId, 'plans', month] as const;

/** Piano del mese, revisione e uscite già fissate (fase 8e). */
export function usePlan(month: string) {
  const { brand } = useBrand();
  return useQuery({
    queryKey: planKey(brand?.id ?? 0, month),
    queryFn: () => api.plan(brand!.id, month),
    enabled: Boolean(brand),
  });
}

function useSetPlan(month: string) {
  const { brand } = useBrand();
  const client = useQueryClient();
  return (state: PlanState) => client.setQueryData(planKey(brand!.id, month), state);
}

/** «Genera il piano»: una chiamata all'AI (decine di secondi). */
export function useGeneratePlan(month: string) {
  const { brand } = useBrand();
  const set = useSetPlan(month);
  return useMutation({
    mutationFn: (platforms: Platform[]) => api.generatePlan(brand!.id, month, platforms),
    onSuccess: set,
  });
}

/** «Metti nel calendario» / «Crea l'idea»: crea solo idee. */
export function usePlanIdeas(month: string) {
  const { brand } = useBrand();
  const client = useQueryClient();
  const set = useSetPlan(month);
  return useMutation({
    mutationFn: (input: PlanIdeasInput) => api.planIdeas(brand!.id, month, input),
    onSuccess: (state) => {
      set(state);
      return client.invalidateQueries({ queryKey: queryKeys.ideas(brand!.id) });
    },
  });
}

export function useCommentPlan(month: string) {
  const { brand } = useBrand();
  const set = useSetPlan(month);
  return useMutation({ mutationFn: () => api.commentPlan(brand!.id, month), onSuccess: set });
}
