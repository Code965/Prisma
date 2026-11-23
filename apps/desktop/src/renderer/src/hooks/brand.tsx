import type { Brand } from '@prisma-app/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api/endpoints';
import { pickBrand } from '../services/brands';
import { PREFERENCE_KEYS, readPreference, writePreference } from '../services/local-preferences';
import { queryKeys } from './query-client';

interface BrandContextValue {
  brand: Brand | null;
  brands: Brand[];
  isLoading: boolean;
  error: unknown;
  selectBrand: (id: number) => void;
}

const BrandContext = createContext<BrandContextValue | null>(null);

/** Brand attivo: quello scelto l'ultima volta, altrimenti il primo. Predisposto per più brand. */
export function BrandProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: queryKeys.brands, queryFn: api.brands });
  const [selectedId, setSelectedId] = useState(
    () => Number(readPreference(PREFERENCE_KEYS.brand)) || null,
  );

  const selectBrand = useCallback((id: number) => {
    setSelectedId(id);
    writePreference(PREFERENCE_KEYS.brand, String(id));
  }, []);

  const value = useMemo<BrandContextValue>(() => {
    const brands = query.data ?? [];
    return {
      brand: pickBrand(brands, selectedId),
      brands,
      isLoading: query.isLoading,
      error: query.error,
      selectBrand,
    };
  }, [query.data, query.isLoading, query.error, selectedId, selectBrand]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const context = useContext(BrandContext);
  if (!context) throw new Error('useBrand va usato dentro BrandProvider');
  return context;
}
