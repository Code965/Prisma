import {
  EditCarouselRequestSchema,
  EditVariantRequestSchema,
  GenerateCarouselRequestSchema,
  GenerateContentSchema,
  GenerateShortsRequestSchema,
  AutoEditRequestSchema,
  VideoScriptRequestSchema,
} from '@prisma-app/shared';
import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params.js';
import type { CarouselAiService } from './carousel.js';
import type { AiService } from './service.js';
import type { ShortsAiService } from './shorts.js';
import type { AutoEditService } from './auto-edit.js';
import type { VideoScriptService } from './video-script.js';

export function aiRoutes(
  app: FastifyInstance,
  ai: AiService,
  carousel: CarouselAiService,
  shorts: ShortsAiService,
  autoEdit: AutoEditService,
  videoScript: VideoScriptService,
): void {
  app.post('/contents/generate', async (request, reply) => {
    const content = await ai.generate(GenerateContentSchema.parse(request.body));
    return reply.code(201).send(content);
  });

  app.post('/variants/:id/edit', (request) =>
    ai.edit(parseId(request.params), EditVariantRequestSchema.parse(request.body)),
  );

  app.get('/contents/:id/chat', (request) => ai.chatHistory(parseId(request.params)));

  app.post('/variants/:id/carousel/generate', (request) =>
    carousel.generate(parseId(request.params), GenerateCarouselRequestSchema.parse(request.body)),
  );

  app.post('/shorts/generate', async (request, reply) => {
    const result = await shorts.generate(GenerateShortsRequestSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  // «Monta con l'AI»: solo la proposta, il desktop la applica al progetto video.
  app.post('/video/auto-edit', (request) =>
    autoEdit.plan(AutoEditRequestSchema.parse(request.body)),
  );

  // «Crea video dall'idea»: solo il copione, il desktop crea il video.
  app.post('/video/script', (request) =>
    videoScript.generate(VideoScriptRequestSchema.parse(request.body)),
  );

  app.post('/variants/:id/carousel/edit', (request) =>
    carousel.edit(parseId(request.params), EditCarouselRequestSchema.parse(request.body)),
  );
}
