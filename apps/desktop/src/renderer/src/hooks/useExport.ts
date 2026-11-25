import type { ExportFormat, Variant, VariantAsset } from '@prisma-app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import { pendingUploads } from '../services/exports';
import { useBrand } from './brand';
import { queryKeys } from './query-client';
import { useBrandKit } from './useBrandKit';

export function useVariantAssets(variantId: number) {
  return useQuery({
    queryKey: queryKeys.variantAssets(variantId),
    queryFn: () => api.variantAssets(variantId),
  });
}

/** R2 configurato sul server? Senza, i file esportati restano solo sul computer. */
export function useStorageStatus() {
  return useQuery({
    queryKey: queryKeys.storageStatus,
    queryFn: () => api.storageStatus(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Carica su R2 i file in attesa, uno alla volta: il server firma l'indirizzo, il main di Electron
 * invia il file, il server verifica che sia arrivato intero.
 */
export async function uploadPending(
  variantId: number,
  assets: VariantAsset[],
): Promise<VariantAsset[]> {
  if (!window.prisma) throw new Error('Il caricamento funziona solo nell’app desktop');
  let current = assets;
  for (const asset of pendingUploads(assets)) {
    const target = await api.startUpload(variantId, asset.assetId);
    await window.prisma.uploadFile({
      localPath: asset.localPath!,
      url: target.url,
      headers: target.headers as { 'Content-Type': 'image/jpeg' | 'application/pdf' | 'video/mp4' },
    });
    current = await api.completeUpload(variantId, asset.assetId);
  }
  return current;
}

/**
 * Esporta le slide salvate: il main di Electron scrive i file, il server li registra sulla
 * variant (rifiutandoli se nel frattempo slide o brand kit sono cambiati) e, se R2 è
 * configurato, vengono caricati subito.
 */
/** «Pulisci ora»: toglie da R2 i file di export superati da più di 7 giorni. */
export function useCleanupStorage() {
  return useMutation({ mutationFn: () => api.cleanupStorage() });
}

export function useExportCarousel(variant: Variant) {
  const { brand } = useBrand();
  const kit = useBrandKit().data;
  const storage = useStorageStatus().data;
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (format: ExportFormat) => {
      const carousel = variant.metadata.carousel;
      if (!window.prisma) throw new Error('L’export funziona solo nell’app desktop');
      if (!carousel || !kit) throw new Error('Slide o brand kit non ancora caricati');
      const result = await window.prisma.exportCarousel({
        variantId: variant.id,
        format,
        carousel,
        kit,
        initials: brand?.initials ?? '',
      });
      const registered = await api.registerExport(variant.id, {
        format,
        renderHash: result.renderHash,
        files: result.files,
      });
      client.setQueryData(queryKeys.variantAssets(variant.id), registered);
      const assets = storage?.configured ? await uploadPending(variant.id, registered) : registered;
      return { result, assets };
    },
    onSuccess: ({ assets }) => client.setQueryData(queryKeys.variantAssets(variant.id), assets),
    // Anche se il caricamento fallisce i file restano registrati: la lista si ricarica.
    onError: () => client.invalidateQueries({ queryKey: queryKeys.variantAssets(variant.id) }),
  });
}

/** «Carica su R2» per i file esportati ma non ancora caricati (es. dopo un errore di rete). */
export function useUploadAssets(variantId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assets: VariantAsset[]) => uploadPending(variantId, assets),
    onSuccess: (assets) => client.setQueryData(queryKeys.variantAssets(variantId), assets),
    onError: () => client.invalidateQueries({ queryKey: queryKeys.variantAssets(variantId) }),
  });
}

export async function showExportedFile(path: string): Promise<void> {
  await window.prisma?.showExport(path);
}
