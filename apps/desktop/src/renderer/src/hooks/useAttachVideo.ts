import type { VideoProject } from '@prisma-app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api/endpoints';
import type { VideoTarget } from '../services/video';
import { queryKeys } from './query-client';
import { uploadPending, useStorageStatus } from './useExport';
import { useBrand } from './brand';

/**
 * Collega il video esportato a una bozza (che torna in revisione) e, se R2 è configurato, lo
 * carica subito come i caroselli.
 */
export function useAttachVideo(project: VideoProject) {
  const storage = useStorageStatus().data;
  const client = useQueryClient();
  const { brand } = useBrand();
  return useMutation({
    mutationFn: async (target: VideoTarget) => {
      const render = project.render;
      if (!render) throw new Error('Esporta prima il video');
      const { variant, assets } = await api.registerVideo(target.variant.id, {
        expectedVersion: target.variant.version,
        file: {
          mime: 'video/mp4',
          sizeBytes: render.sizeBytes,
          width: render.width,
          height: render.height,
          durationMs: render.durationMs,
          checksumSha256: render.checksumSha256,
          localPath: render.path,
        },
      });
      const uploaded = storage?.configured ? await uploadPending(variant.id, assets) : assets;
      return { variant, assets: uploaded, target };
    },
    onSettled: () => {
      if (brand) void client.invalidateQueries({ queryKey: queryKeys.contents(brand.id) });
    },
    onSuccess: ({ target, assets }) => {
      client.setQueryData(queryKeys.variantAssets(target.variant.id), assets);
      void client.invalidateQueries({ queryKey: queryKeys.content(target.content.id) });
    },
  });
}
