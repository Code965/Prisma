import type { Content, Variant, VariantMetadata } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { approvalSteps } from '../services/studio';
import { useBrand } from './brand';
import { queryKeys } from './query-client';

export function useContent(id: number | null) {
  return useQuery({
    queryKey: queryKeys.content(id ?? 0),
    queryFn: () => api.content(id!),
    enabled: id !== null,
  });
}

export function useIdea(id: number | null) {
  return useQuery({
    queryKey: queryKeys.idea(id ?? 0),
    queryFn: () => api.idea(id!),
    enabled: id !== null,
  });
}

export function useChat(contentId: number) {
  return useQuery({ queryKey: queryKeys.chat(contentId), queryFn: () => api.chat(contentId) });
}

export function useRevisions(variantId: number) {
  return useQuery({
    queryKey: queryKeys.revisions(variantId),
    queryFn: () => api.revisions(variantId),
  });
}

/** Sostituisce una variant nel contenuto in cache: lo stato si aggiorna senza ricaricare. */
export function useReplaceVariant(contentId: number) {
  const client = useQueryClient();
  return (variant: Variant) => {
    client.setQueryData<Content>(queryKeys.content(contentId), (content) =>
      content
        ? { ...content, variants: content.variants.map((v) => (v.id === variant.id ? variant : v)) }
        : content,
    );
    void client.invalidateQueries({ queryKey: queryKeys.revisions(variant.id) });
  };
}

export interface DraftValues {
  body: string;
  metadata: VariantMetadata;
}

export function useSaveVariant(contentId: number) {
  const replace = useReplaceVariant(contentId);
  return useMutation({
    mutationFn: ({ variant, draft }: { variant: Variant; draft: DraftValues }) =>
      api.saveVariant(variant.id, { ...draft, expectedVersion: variant.version }),
    onSuccess: replace,
  });
}

/**
 * "Approva": salva le modifiche se ci sono, poi passa da `da_approvare` ad `approvato`.
 * Ogni passo usa la versione restituita dal precedente (lock ottimistico).
 */
export function useApproveVariant(contentId: number) {
  const replace = useReplaceVariant(contentId);
  const { brand } = useBrand();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      variant,
      draft,
      dirty,
    }: {
      variant: Variant;
      draft: DraftValues;
      dirty: boolean;
    }) => {
      let current = variant;
      for (const step of approvalSteps(variant.status, dirty)) {
        current =
          step === 'save'
            ? await api.saveVariant(current.id, { ...draft, expectedVersion: current.version })
            : await api.transitionVariant(current.id, {
                action: step,
                expectedVersion: current.version,
              });
        replace(current);
      }
      return current;
    },
    onSettled: () => {
      if (!brand) return;
      void client.invalidateQueries({ queryKey: queryKeys.ideas(brand.id) });
      void client.invalidateQueries({ queryKey: queryKeys.contents(brand.id) });
    },
  });
}

/** Modifica scrivendo: salva prima le modifiche a mano, poi chiede la riscrittura all'LLM. */
export function useEditWithAi(contentId: number) {
  const replace = useReplaceVariant(contentId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      variant,
      draft,
      dirty,
      instruction,
    }: {
      variant: Variant;
      draft: DraftValues;
      dirty: boolean;
      instruction: string;
    }) => {
      let current = variant;
      if (dirty) {
        current = await api.saveVariant(current.id, { ...draft, expectedVersion: current.version });
        replace(current);
      }
      return api.editWithAi(current.id, { instruction, expectedVersion: current.version });
    },
    onSuccess: (result) => replace(result.variant),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.chat(contentId) }),
  });
}

export function useRestoreRevision(contentId: number) {
  const replace = useReplaceVariant(contentId);
  return useMutation({
    mutationFn: ({ variant, revisionId }: { variant: Variant; revisionId: number }) =>
      api.restoreRevision(variant.id, revisionId, variant.version),
    onSuccess: replace,
  });
}
