import type { EditCarouselRequest, Variant } from '@prisma-app/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { useReplaceVariant } from './useStudio';

/** Crea le slide dal testo del post con l'LLM; la variant salvata sostituisce quella in cache. */
export function useGenerateCarousel(contentId: number) {
  const replace = useReplaceVariant(contentId);
  return useMutation({
    mutationFn: (variant: Variant) => api.generateCarousel(variant.id, variant.version),
    onSuccess: replace,
  });
}

/** «Modifica la slide scrivendo»: se l'LLM ha cambiato le slide, la variant salvata entra in cache. */
export function useEditCarousel(contentId: number) {
  const replace = useReplaceVariant(contentId);
  return useMutation({
    mutationFn: ({
      variant,
      ...input
    }: Omit<EditCarouselRequest, 'expectedVersion'> & { variant: Variant }) =>
      api.editCarousel(variant.id, { ...input, expectedVersion: variant.version }),
    onSuccess: (result) => {
      if (result.variant) replace(result.variant);
    },
  });
}
