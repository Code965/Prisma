import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectionSettingsInput } from '../../../main/ipc-contract';
import { api } from '../services/api/endpoints';
import { queryKeys } from './query-client';

/** Impostazioni di collegamento al server: esistono solo in Electron. */
export function useConnectionSettings() {
  return useQuery({
    queryKey: queryKeys.connection,
    queryFn: () => window.prisma!.settings.get(),
    enabled: Boolean(window.prisma),
  });
}

export function useSaveConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectionSettingsInput) => window.prisma!.settings.save(input),
    onSuccess: (view) => {
      client.setQueryData(queryKeys.connection, view);
      // Con un nuovo server o token tutti i dati vanno ricaricati.
      return client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'connection' });
    },
  });
}

/** Prova il collegamento chiamando una rotta protetta. */
export function useTestConnection() {
  return useMutation({ mutationFn: () => api.me() });
}
