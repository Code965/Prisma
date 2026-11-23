import {
  RestoreRevisionSchema,
  VariantCreateSchema,
  VariantEditSchema,
  VariantTransitionSchema,
} from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ContentParamsSchema, parseId } from '../../http/params.js';

const RevisionParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  revisionId: z.coerce.number().int().positive(),
});
import type { VariantService } from './service.js';

export function variantRoutes(app: FastifyInstance, variants: VariantService): void {
  app.post('/contents/:contentId/variants', async (request, reply) => {
    const { contentId } = ContentParamsSchema.parse(request.params);
    const variant = await variants.create(contentId, VariantCreateSchema.parse(request.body));
    return reply.code(201).send(variant);
  });

  app.get('/variants/:id', (request) => variants.get(parseId(request.params)));

  app.patch('/variants/:id', (request) =>
    variants.edit(parseId(request.params), VariantEditSchema.parse(request.body)),
  );

  app.post('/variants/:id/transitions', (request) =>
    variants.transition(parseId(request.params), VariantTransitionSchema.parse(request.body)),
  );

  app.get('/variants/:id/revisions', (request) => variants.revisions(parseId(request.params)));

  app.post('/variants/:id/revisions/:revisionId/restore', (request) => {
    const { id, revisionId } = RevisionParamsSchema.parse(request.params);
    const { expectedVersion } = RestoreRevisionSchema.parse(request.body);
    return variants.restore(id, revisionId, expectedVersion);
  });

  app.delete('/variants/:id', async (request, reply) => {
    await variants.remove(parseId(request.params));
    return reply.code(204).send();
  });
}
