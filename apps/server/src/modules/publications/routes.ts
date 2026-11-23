import { PublicationListQuerySchema, RescheduleSchema, ScheduleSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseId } from '../../http/params.js';

const BrandQuerySchema = z.object({ brandId: z.coerce.number().int().positive() });
import type { PublicationService } from './service.js';

export function publicationRoutes(app: FastifyInstance, publications: PublicationService): void {
  app.get('/publications', (request) =>
    publications.list(PublicationListQuerySchema.parse(request.query)),
  );

  app.get('/publications/checks', (request) =>
    publications.checks(BrandQuerySchema.parse(request.query).brandId),
  );

  app.post('/publications', async (request, reply) => {
    const publication = await publications.schedule(ScheduleSchema.parse(request.body));
    return reply.code(201).send(publication);
  });

  app.get('/publications/:id', (request) => publications.get(parseId(request.params)));

  app.patch('/publications/:id', (request) =>
    publications.reschedule(
      parseId(request.params),
      RescheduleSchema.parse(request.body).scheduledAt,
    ),
  );

  app.post('/publications/:id/publish-now', (request) =>
    publications.publishNow(parseId(request.params)),
  );

  app.post('/publications/:id/cancel', (request) => publications.cancel(parseId(request.params)));

  app.post('/publications/:id/retry', (request) => publications.retry(parseId(request.params)));

  app.get('/publications/:id/attempts', (request) =>
    publications.attempts(parseId(request.params)),
  );
}
