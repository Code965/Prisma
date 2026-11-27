import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TrendsService } from './service.js';

export function trendRoutes(app: FastifyInstance, trends: TrendsService): void {
  const brandOf = (params: unknown) =>
    z.object({ brandId: z.coerce.number().int().positive() }).parse(params).brandId;

  app.get('/brands/:brandId/trends', (request) => trends.state(brandOf(request.params)));

  app.put('/brands/:brandId/trends/keywords', (request) =>
    trends.saveKeywords(brandOf(request.params), request.body),
  );

  // «Aggiorna»: raccolta dalle fonti e nuovi trend dall'AI.
  app.post('/brands/:brandId/trends', async (request, reply) =>
    reply.code(201).send(await trends.refreshNow(brandOf(request.params))),
  );
}
