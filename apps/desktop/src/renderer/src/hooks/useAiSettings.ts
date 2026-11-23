import type { AiSettingsInput } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { queryKeys } from './query-client';

export function useAiSettings() {
  return useQuery({ queryKey: queryKeys.aiSettings, queryFn: api.aiSettings });
}

export function useSaveAiSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AiSettingsInput) => api.saveAiSettings(input),
    onSuccess: (view) => client.setQueryData(queryKeys.aiSettings, view),
  });
}

export function useRemoveAiSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.removeAiSettings(),
    onSuccess: (view) => client.setQueryData(queryKeys.aiSettings, view),
  });
}

export function useTestAiSettings() {
  return useMutation({ mutationFn: (input?: AiSettingsInput) => api.testAiSettings(input) });
}
