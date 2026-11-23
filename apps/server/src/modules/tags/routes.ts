import { TagInputSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseBrandId, parseId } from '../../http/params.js';
import type { TagService } from './service.js';

export function tagRoutes(app: FastifyInstance, tags: TagService): void {
  app.get('/brands/:brandId/tags', (request) => tags.list(parseBrandId(request.params)));

  app.post('/brands/:brandId/tags', async (request, reply) => {
    const tag = await tags.create(parseBrandId(request.params), TagInputSchema.parse(request.body));
    return reply.code(201).send(tag);
  });

  app.delete('/tags/:id', async (request, reply) => {
    await tags.remove(parseId(request.params));
    return reply.code(204).send();
  });
}
