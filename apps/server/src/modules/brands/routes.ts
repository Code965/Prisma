import { BrandInputSchema, BrandUpdateSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params.js';
import type { BrandService } from './service.js';

export function brandRoutes(app: FastifyInstance, brands: BrandService): void {
  app.get('/brands', () => brands.list());

  app.get('/brands/:id', (request) => brands.get(parseId(request.params)));

  app.post('/brands', async (request, reply) => {
    const brand = await brands.create(BrandInputSchema.parse(request.body));
    return reply.code(201).send(brand);
  });

  app.patch('/brands/:id', (request) =>
    brands.update(parseId(request.params), BrandUpdateSchema.parse(request.body)),
  );
}
