import { APP_CREDENTIAL_KEYS } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCredentialsService } from './service.js';

const KeyParamsSchema = z.object({ key: z.enum(APP_CREDENTIAL_KEYS) });

export function appCredentialsRoutes(
  app: FastifyInstance,
  credentials: AppCredentialsService,
): void {
  app.get('/settings/apps', () => credentials.list());

  app.put('/settings/apps/:key', (request) =>
    credentials.save(KeyParamsSchema.parse(request.params).key, request.body),
  );

  app.delete('/settings/apps/:key', (request) =>
    credentials.remove(KeyParamsSchema.parse(request.params).key),
  );
}
