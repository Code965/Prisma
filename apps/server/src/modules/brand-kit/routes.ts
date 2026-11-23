import { BrandKitSchema, VoiceExampleInputSchema } from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseBrandId, parseId } from '../../http/params.js';
import type { BrandKitService } from './service.js';

export function brandKitRoutes(app: FastifyInstance, kits: BrandKitService): void {
  app.get('/brands/:brandId/kit', (request) => kits.getKit(parseBrandId(request.params)));

  app.put('/brands/:brandId/kit', (request) =>
    kits.saveKit(parseBrandId(request.params), BrandKitSchema.parse(request.body)),
  );

  app.get('/brands/:brandId/voice-examples', (request) =>
    kits.listVoiceExamples(parseBrandId(request.params)),
  );

  app.post('/brands/:brandId/voice-examples', async (request, reply) => {
    const example = await kits.addVoiceExample(
      parseBrandId(request.params),
      VoiceExampleInputSchema.parse(request.body),
    );
    return reply.code(201).send(example);
  });

  app.delete('/voice-examples/:id', async (request, reply) => {
    await kits.removeVoiceExample(parseId(request.params));
    return reply.code(204).send();
  });
}
