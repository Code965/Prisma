import type { Platform, PublicationView } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../services/api/client';
import { api } from '../services/api/endpoints';
import { PLATFORM_LABELS } from '@prisma-app/shared';
import { useBrand } from './brand';
import { useSocialAccounts } from './useAccounts';
import { queryKeys } from './query-client';

export function usePublications() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.publications(brand?.id ?? 0),
    queryFn: () => api.publications(brand!.id),
    enabled: Boolean(brand),
  });
}

/** Elimina un contenuto mai uscito (il server rifiuta quelli con pubblicazioni). */
export function useDeleteContent() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteContent(id),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.contents(brand?.id ?? 0) }),
  });
}

export function useContents() {
  const { brand } = useBrand();
  return useQuery({
    queryKey: queryKeys.contents(brand?.id ?? 0),
    queryFn: () => api.contents(brand!.id),
    enabled: Boolean(brand),
  });
}

function useInvalidatePlanning() {
  const { brand } = useBrand();
  const client = useQueryClient();
  return () => {
    if (!brand) return;
    void client.invalidateQueries({ queryKey: queryKeys.publications(brand.id) });
    void client.invalidateQueries({ queryKey: queryKeys.contents(brand.id) });
  };
}

/**
 * Programma una variant approvata nello slot scelto, sull'account collegato della sua
 * piattaforma. Senza account collegato si ferma con un messaggio chiaro.
 */
export function useSchedule() {
  const accounts = useSocialAccounts();
  const invalidate = useInvalidatePlanning();
  return useMutation({
    mutationFn: ({
      variantId,
      platform,
      scheduledAt,
    }: {
      variantId: number;
      platform: Platform;
      scheduledAt: string;
    }) => {
      const account = accounts.data?.find(
        (a) => a.platform === platform && a.status !== 'scollegato',
      );
      if (!account) {
        throw new ApiError(
          422,
          'account_mancante',
          `Collega prima l'account ${PLATFORM_LABELS[platform]} nelle Impostazioni`,
        );
      }
      return api.schedule({ variantId, socialAccountId: account.id, scheduledAt });
    },
    onSettled: invalidate,
  });
}

/** Sposta una pubblicazione: la si vede subito nel nuovo slot, e torna indietro se il server rifiuta. */
export function useReschedule() {
  const { brand } = useBrand();
  const client = useQueryClient();
  const invalidate = useInvalidatePlanning();
  const key = queryKeys.publications(brand?.id ?? 0);

  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: number; scheduledAt: string }) =>
      api.reschedule(id, scheduledAt),
    onMutate: async ({ id, scheduledAt }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PublicationView[]>(key);
      client.setQueryData<PublicationView[]>(key, (list) =>
        list?.map((p) => (p.id === id ? { ...p, scheduledAt, nextAttemptAt: scheduledAt } : p)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous),
    onSettled: invalidate,
  });
}

/** "Usa orari consigliati": più spostamenti in fila, poi un solo ricaricamento. */
export function useRescheduleMany() {
  const invalidate = useInvalidatePlanning();
  return useMutation({
    mutationFn: async (moves: Array<{ publicationId: number; scheduledAt: string }>) => {
      for (const move of moves) await api.reschedule(move.publicationId, move.scheduledAt);
    },
    onSettled: invalidate,
  });
}
