import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlanService } from './service.js';

const ParamsSchema = z.object({
  brandId: z.coerce.number().int().positive(),
  month: z.string(),
});

export function planRoutes(app: FastifyInstance, plans: PlanService): void {
  const params = (raw: unknown) => ParamsSchema.parse(raw);

  app.get('/brands/:brandId/plans/:month', (request) => {
    const { brandId, month } = params(request.params);
    return plans.state(brandId, month);
  });

  // Genera (o rigenera) il piano del mese con l'AI.
  app.post('/brands/:brandId/plans/:month', async (request, reply) => {
    const { brandId, month } = params(request.params);
    return reply.code(201).send(await plans.generate(brandId, month, request.body));
  });

  // «Metti nel calendario» / «Crea l'idea»: solo idee, mai bozze approvate o pubblicazioni.
  app.post('/brands/:brandId/plans/:month/ideas', (request) => {
    const { brandId, month } = params(request.params);
    return plans.createIdeas(brandId, month, request.body);
  });

  // Commento dell'AI sulla revisione del mese.
  app.post('/brands/:brandId/plans/:month/review', (request) => {
    const { brandId, month } = params(request.params);
    return plans.comment(brandId, month);
  });
}
