import { ContentInputSchema, ContentUpdateSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseBrandId, parseId } from '../../http/params.js';
import type { ContentService } from './service.js';

export function contentRoutes(app: FastifyInstance, contents: ContentService): void {
  app.get('/brands/:brandId/contents', (request) => contents.list(parseBrandId(request.params)));

  app.post('/brands/:brandId/contents', async (request, reply) => {
    const content = await contents.create(
      parseBrandId(request.params),
      ContentInputSchema.parse(request.body),
    );
    return reply.code(201).send(content);
  });

  app.get('/contents/:id', (request) => contents.get(parseId(request.params)));

  app.patch('/contents/:id', (request) =>
    contents.update(parseId(request.params), ContentUpdateSchema.parse(request.body)),
  );

  app.delete('/contents/:id', async (request, reply) => {
    await contents.remove(parseId(request.params));
    return reply.code(204).send();
  });
}
