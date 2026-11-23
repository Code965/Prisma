import type { BlogConnection } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OAuthPlatform } from '../services/api/endpoints';
import { openExternal } from '../services/external';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

export function useSocialAccounts() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.accounts(brand?.id ?? 0),
    queryFn: () => api.socialAccounts(brand!.id),
    enabled: Boolean(brand),
  });
}

/**
 * Collega LinkedIn o Instagram: il server prepara l'URL di autorizzazione (con lo state firmato)
 * e lo si apre nel browser di sistema. Al ritorno la pagina del server conferma il collegamento.
 */
export function useConnectAccount() {
  const { brand } = useBrand();
  return useMutation({
    mutationFn: async (platform: OAuthPlatform) => {
      const { url } = await api.authorizationUrl(platform, brand!.id);
      await openExternal(url);
    },
  });
}

/** Collega il blog: il server verifica indirizzo e chiave con il sito prima di salvarli. */
export function useConnectBlog() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BlogConnection) => api.connectBlog(brand!.id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.accounts(brand!.id) }),
  });
}

export function useTestBlog() {
  const { brand } = useBrand();
  return useMutation({ mutationFn: () => api.testBlog(brand!.id) });
}
