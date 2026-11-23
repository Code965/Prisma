import type { BrandKit, VoiceExampleInput } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

export function useBrandKit() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.brandKit(brand?.id ?? 0),
    queryFn: () => api.brandKit(brand!.id),
    enabled: Boolean(brand),
  });
}

/** Salva il kit intero: il server lo valida e restituisce la versione normalizzata. */
export function useSaveBrandKit() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (kit: BrandKit) => api.saveBrandKit(brand!.id, kit),
    onSuccess: (saved) => client.setQueryData(queryKeys.brandKit(brand!.id), saved),
  });
}

export function useVoiceExamples() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.voiceExamples(brand?.id ?? 0),
    queryFn: () => api.voiceExamples(brand!.id),
    enabled: Boolean(brand),
  });
}

export function useAddVoiceExample() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VoiceExampleInput) => api.addVoiceExample(brand!.id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.voiceExamples(brand!.id) }),
  });
}

export function useDeleteVoiceExample() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteVoiceExample(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.voiceExamples(brand!.id) }),
  });
}
