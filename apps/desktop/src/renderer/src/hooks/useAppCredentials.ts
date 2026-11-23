import type { AppCredentialKey, AppCredentialView } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { queryKeys } from './query-client';

/** App delle piattaforme e archivio R2 (Impostazioni › Account). */
export function useAppCredentials() {
  return useQuery({ queryKey: queryKeys.appCredentials, queryFn: api.appCredentials });
}

function replace(views: AppCredentialView[] | undefined, next: AppCredentialView) {
  return views?.map((view) => (view.key === next.key ? next : view));
}

export function useSaveAppCredentials() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: AppCredentialKey; body: unknown }) =>
      api.saveAppCredentials(key, body),
    onSuccess: (view) =>
      client.setQueryData<AppCredentialView[]>(queryKeys.appCredentials, (views) =>
        replace(views, view),
      ),
  });
}

export function useRemoveAppCredentials() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: AppCredentialKey) => api.removeAppCredentials(key),
    onSuccess: (view) =>
      client.setQueryData<AppCredentialView[]>(queryKeys.appCredentials, (views) =>
        replace(views, view),
      ),
  });
}
