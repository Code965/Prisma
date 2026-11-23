import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/** Confronto a tempo costante: si confrontano gli hash, così la lunghezza non trapela. */
export function isValidToken(candidate: string, expected: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

interface ApiTokenOptions {
  token: string;
  /** Percorsi raggiungibili senza token (es. health check). */
  publicPaths: readonly string[];
}

async function apiTokenPlugin(app: FastifyInstance, options: ApiTokenOptions): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (options.publicPaths.includes(path)) return;

    const token = extractBearer(request.headers.authorization);
    if (!token || !isValidToken(token, options.token)) {
      return reply
        .code(401)
        .send({ error: 'non_autorizzato', message: 'Token API mancante o non valido' });
    }
  });
}

export const apiToken = fp(apiTokenPlugin, { name: 'api-token' });
