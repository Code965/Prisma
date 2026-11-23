import type { Tag } from '@prisma-app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../services/api/endpoints';
import { PREFERENCE_KEYS, readPreference, writePreference } from '../services/local-preferences';
import { initialsFrom, tagChanges } from '../services/setup';
import { queryKeys } from './query-client';

/** Configurazione guidata completata (o saltata): ricordato su questo computer. */
export function useSetupDone(): [boolean, (done: boolean) => void] {
  const [done, setDone] = useState(() => readPreference(PREFERENCE_KEYS.setupDone) === '1');
  return [
    done,
    (value: boolean) => {
      writePreference(PREFERENCE_KEYS.setupDone, value ? '1' : '0');
      setDone(value);
    },
  ];
}

/** Passo «Il tuo brand»: nome, iniziali e argomenti, salvati insieme. */
export function useSaveBrandSetup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      brandId: number;
      name: string;
      initials: string;
      existingTags: readonly Tag[];
      tags: readonly string[];
    }) => {
      await api.updateBrand(input.brandId, {
        name: input.name.trim(),
        initials: (input.initials.trim() || initialsFrom(input.name)).slice(0, 3).toUpperCase(),
      });
      const { add, remove } = tagChanges(input.existingTags, input.tags);
      for (const tag of remove) await api.deleteTag(tag.id);
      for (const name of add) await api.createTag(input.brandId, { name });
    },
    onSuccess: async (_result, input) => {
      await client.invalidateQueries({ queryKey: queryKeys.brands });
      await client.invalidateQueries({ queryKey: queryKeys.tags(input.brandId) });
    },
  });
}
