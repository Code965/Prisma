import { IdeaInputSchema, IdeaListQuerySchema, IdeaUpdateSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseBrandId, parseId } from '../../http/params.js';
import { z } from 'zod';
import type { ContentService } from '../contents/service.js';
import type { IdeaService } from './service.js';

const DeleteIdeaQuerySchema = z.object({ contenuti: z.enum(['bozze']).optional() });

export function ideaRoutes(
  app: FastifyInstance,
  ideas: IdeaService,
  contents: ContentService,
): void {
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

  // `?contenuti=bozze`: con l'idea spariscono anche i suoi contenuti mai usciti (nessuna
  // pubblicazione); quelli pubblicati o in coda restano. Senza: si elimina solo l'idea.
  app.delete('/ideas/:id', async (request, reply) => {
    const { contenuti } = DeleteIdeaQuerySchema.parse(request.query);
    const result = await contents.removeIdea(parseId(request.params), contenuti === 'bozze');
    return reply.code(200).send(result);
  });
}
