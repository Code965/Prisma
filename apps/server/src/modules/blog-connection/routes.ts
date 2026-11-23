import { BlogConnectionSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseBrandId } from '../../http/params.js';
import type { BlogConnectionService } from './service.js';

export function blogConnectionRoutes(app: FastifyInstance, blog: BlogConnectionService): void {
  // Salva (o aggiorna) indirizzo e chiave del sito, dopo averli verificati.
  app.put('/brands/:brandId/blog-connection', (request) =>
    blog.connect(parseBrandId(request.params), BlogConnectionSchema.parse(request.body)),
  );

  app.post('/brands/:brandId/blog-connection/test', (request) =>
    blog.test(parseBrandId(request.params)),
  );
}
