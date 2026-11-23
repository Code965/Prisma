import { RegisterExportSchema, RegisterVideoSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseId } from '../../http/params.js';
import type { AssetService } from './service.js';

const AssetParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  assetId: z.coerce.number().int().positive(),
});

export function assetRoutes(app: FastifyInstance, assets: AssetService): void {
  app.get('/variants/:id/assets', (request) => assets.list(parseId(request.params)));

  app.put('/variants/:id/assets/export', (request) =>
    assets.registerExport(parseId(request.params), RegisterExportSchema.parse(request.body)),
  );

  app.put('/variants/:id/assets/video', (request) =>
    assets.registerVideo(parseId(request.params), RegisterVideoSchema.parse(request.body)),
  );

  app.post('/variants/:id/assets/:assetId/upload', (request) => {
    const { id, assetId } = AssetParamsSchema.parse(request.params);
    return assets.startUpload(id, assetId);
  });

  app.post('/variants/:id/assets/:assetId/upload/complete', (request) => {
    const { id, assetId } = AssetParamsSchema.parse(request.params);
    return assets.completeUpload(id, assetId);
  });

  app.get('/storage/status', () => assets.storageStatus());
}
