import { AiSettingsInputSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import type { AiSettingsService } from './service.js';

export function aiSettingsRoutes(app: FastifyInstance, settings: AiSettingsService): void {
  app.get('/ai/settings', () => settings.view());

  app.put('/ai/settings', (request) => settings.save(AiSettingsInputSchema.parse(request.body)));

  app.delete('/ai/settings', () => settings.remove());

  // Con un corpo prova quel servizio (prima di salvarlo), senza corpo quello in uso.
  app.post('/ai/settings/test', (request) =>
    settings.test(request.body ? AiSettingsInputSchema.parse(request.body) : null),
  );
}
