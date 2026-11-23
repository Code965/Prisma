import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../services/api/client';

/** Gli errori 4xx sono definitivi (dati non validi, non trovato): non ha senso ritentarli. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

/** Chiavi delle query, in un posto solo per invalidarle in modo coerente. */
export const queryKeys = {
  brands: ['brands'] as const,
  tags: (brandId: number) => ['brands', brandId, 'tags'] as const,
  brandKit: (brandId: number) => ['brands', brandId, 'kit'] as const,
  voiceExamples: (brandId: number) => ['brands', brandId, 'voice-examples'] as const,
  ideas: (brandId: number) => ['brands', brandId, 'ideas'] as const,
  accounts: (brandId: number) => ['brands', brandId, 'accounts'] as const,
  contents: (brandId: number) => ['brands', brandId, 'contents'] as const,
  publications: (brandId: number) => ['brands', brandId, 'publications'] as const,
  checks: (brandId: number) => ['brands', brandId, 'publication-checks'] as const,
  content: (id: number) => ['contents', id] as const,
  variantAssets: (variantId: number) => ['variants', variantId, 'assets'] as const,
  storageStatus: ['storage-status'] as const,
  chat: (contentId: number) => ['contents', contentId, 'chat'] as const,
  idea: (id: number) => ['ideas', id] as const,
  revisions: (variantId: number) => ['variants', variantId, 'revisions'] as const,
  connection: ['connection'] as const,
  aiSettings: ['ai-settings'] as const,
  appCredentials: ['app-credentials'] as const,
};
