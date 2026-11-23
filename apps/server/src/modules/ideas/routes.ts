import { IdeaInputSchema, IdeaListQuerySchema, IdeaUpdateSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseBrandId, parseId } from '../../http/params.js';
import type { IdeaService } from './service.js';

export function ideaRoutes(app: FastifyInstance, ideas: IdeaService): void {
  app.get('/brands/:brandId/ideas', (request) =>
    ideas.list(parseBrandId(request.params), IdeaListQuerySchema.parse(request.query)),
  );

  app.post('/brands/:brandId/ideas', async (request, reply) => {
    const idea = await ideas.create(
      parseBrandId(request.params),
      IdeaInputSchema.parse(request.body),
    );
    return reply.code(201).send(idea);
  });

  app.get('/ideas/:id', (request) => ideas.get(parseId(request.params)));

  app.patch('/ideas/:id', (request) =>
    ideas.update(parseId(request.params), IdeaUpdateSchema.parse(request.body)),
  );

  app.delete('/ideas/:id', async (request, reply) => {
    await ideas.remove(parseId(request.params));
    return reply.code(204).send();
  });
}
