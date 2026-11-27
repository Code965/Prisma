import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InspireRequestSchema } from '@prisma-app/shared';
import type { InspireService } from '../ai/inspire.js';
import type { CompetitorsService } from './service.js';

export function competitorRoutes(
  app: FastifyInstance,
  competitors: CompetitorsService,
  inspire: InspireService,
): void {
  const idOf = (params: unknown, key: string) =>
    z.object({ [key]: z.coerce.number().int().positive() }).parse(params)[key]!;

  app.get('/brands/:brandId/competitors', (request) =>
    competitors.state(idOf(request.params, 'brandId')),
  );

  app.post('/brands/:brandId/competitors', async (request, reply) =>
    reply.code(201).send(await competitors.create(idOf(request.params, 'brandId'), request.body)),
  );

  app.delete('/competitors/:id', async (request, reply) => {
    await competitors.remove(idOf(request.params, 'id'));
    return reply.code(204).send();
  });

  // «Aggiorna» un canale YouTube.
  app.post('/competitors/:id/refresh', (request) =>
    competitors.refresh(idOf(request.params, 'id')),
  );

  app.post('/competitors/:id/posts', async (request, reply) =>
    reply.code(201).send(await competitors.addPost(idOf(request.params, 'id'), request.body)),
  );

  app.delete('/competitor-posts/:id', async (request, reply) => {
    await competitors.removePost(idOf(request.params, 'id'));
    return reply.code(204).send();
  });

  // Analisi dell'AI dei post migliori dei concorrenti.
  app.post('/brands/:brandId/competitors/analysis', async (request, reply) =>
    reply.code(201).send(await competitors.analyze(idOf(request.params, 'brandId'))),
  );

  // «Ispirati»: meccanismo del post e proposta di idea, senza salvare nulla.
  app.post('/brands/:brandId/inspire', (request) =>
    inspire.inspire(idOf(request.params, 'brandId'), InspireRequestSchema.parse(request.body)),
  );
}
