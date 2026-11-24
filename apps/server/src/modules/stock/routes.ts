import type { FastifyInstance } from 'fastify';
import type { StockService } from './service.js';

/** Archivio di B-roll (Pixabay): chiave dell'utente e ricerca. La chiave non torna mai al desktop. */
export function stockRoutes(app: FastifyInstance, stock: StockService): void {
  app.get('/stock/status', () => stock.status());
  app.put('/stock/key', (request) => stock.setKey(request.body));
  app.delete('/stock/key', () => stock.removeKey());
  app.get('/stock/search', (request) => stock.search(request.query as never));
}
