import type { AnalyticsPeriod, ManualMetricsInput } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';

const reportKey = (brandId: number, period: AnalyticsPeriod) =>
  ['brands', brandId, 'analytics', period] as const;

/** Report della schermata Analytics per il brand attivo. */
export function useAnalyticsReport(period: AnalyticsPeriod) {
  const { brand } = useBrand();
  return useQuery({
    queryKey: reportKey(brand?.id ?? 0, period),
    queryFn: () => api.analyticsReport(brand!.id, period),
    enabled: Boolean(brand),
  });
}

/** Metriche LinkedIn inserite a mano: poi si ricalcola il report. */
export function useSaveManualMetrics() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ publicationId, input }: { publicationId: number; input: ManualMetricsInput }) =>
      api.saveManualMetrics(publicationId, input),
    onSuccess: () => {
      if (brand) void client.invalidateQueries({ queryKey: ['brands', brand.id, 'analytics'] });
    },
  });
}

/** Slot consigliati dai dati; finché non arrivano il calendario usa quelli predefiniti. */
export function useRecommendedSlots() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: ['brands', brand?.id ?? 0, 'analytics', 'slots'],
    queryFn: () => api.recommendedSlots(brand!.id),
    enabled: Boolean(brand),
    staleTime: 60 * 60_000,
  });
}

/** Ultimi 7 giorni per la Dashboard. */
export function useWeekSummary() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: ['brands', brand?.id ?? 0, 'analytics', 'summary'],
    queryFn: () => api.weekSummary(brand!.id),
    enabled: Boolean(brand),
  });
}

/** Suggerimenti dell'AI dell'ultima settimana e perché mancano, se mancano. */
export function useInsights() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: ['brands', brand?.id ?? 0, 'analytics', 'insights'],
    queryFn: () => api.insights(brand!.id),
    enabled: Boolean(brand),
  });
}

/** «Aggiorna» / «Genera ora»: una chiamata all'LLM, poi si rilegge lo stato. */
export function useGenerateInsights() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateInsights(brand!.id),
    onSuccess: () => {
      if (brand) {
        void client.invalidateQueries({ queryKey: ['brands', brand.id, 'analytics', 'insights'] });
      }
    },
  });
}

/** «Cosa funziona nei tuoi post»: gruppi calcolati dal server (fase 8d). */
export function usePostAnalysis() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: ['brands', brand?.id ?? 0, 'analytics', 'posts'],
    queryFn: () => api.postAnalysis(brand!.id),
    enabled: Boolean(brand),
  });
}

/** «Analizza con l'AI»: aperture classificate e conclusioni; il server non salva nulla. */
export function useAnalyzePosts() {
  const { brand } = useBrand();
  return useMutation({ mutationFn: () => api.analyzePosts(brand!.id) });
}
