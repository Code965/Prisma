import type { FastifyInstance } from 'fastify';
import { parseBrandId } from '../../http/params.js';
import type { SocialAccountService } from './service.js';

export function socialAccountRoutes(app: FastifyInstance, accounts: SocialAccountService): void {
  app.get('/brands/:brandId/social-accounts', (request) =>
    accounts.list(parseBrandId(request.params)),
  );
}
