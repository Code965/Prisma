import { AnalyticsPeriodSchema, ManualMetricsInputSchema } from '@prisma-app/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params.js';
import type { InsightsService } from './insights.js';
import type { PostAnalysisService } from './post-analysis-service.js';
import type { AnalyticsService } from './service.js';

const ReportQuerySchema = z.object({ period: AnalyticsPeriodSchema.default('8w') });

export function analyticsRoutes(
  app: FastifyInstance,
  analytics: AnalyticsService,
  insights: InsightsService,
  postAnalysis: PostAnalysisService,
): void {
  const brandOf = (params: unknown) =>
    z.object({ brandId: z.coerce.number().int().positive() }).parse(params).brandId;

  app.get('/brands/:brandId/analytics/slots', (request) =>
    analytics.slots(brandOf(request.params)),
  );

  app.get('/brands/:brandId/analytics/insights', (request) =>
    insights.state(brandOf(request.params)),
  );

  // «Aggiorna»: nuovi suggerimenti subito, senza aspettare il lunedì.
  app.post('/brands/:brandId/analytics/insights', async (request, reply) =>
    reply.code(201).send(await insights.generate(brandOf(request.params))),
  );

  // Analisi dei propri post (fase 8d); con POST anche l'AI, senza salvare.
  app.get('/brands/:brandId/analytics/posts', (request) =>
    postAnalysis.report(brandOf(request.params)),
  );

  app.post('/brands/:brandId/analytics/posts', (request) =>
    postAnalysis.analyze(brandOf(request.params)),
  );

  app.get('/brands/:brandId/analytics/summary', (request) =>
    analytics.summary(brandOf(request.params)),
  );

  app.get('/brands/:brandId/analytics', (request) => {
    const { brandId } = z
      .object({ brandId: z.coerce.number().int().positive() })
      .parse(request.params);
    return analytics.report(brandId, ReportQuerySchema.parse(request.query).period);
  });

  app.get('/publications/:id/metrics', async (request) => ({
    metrics: await analytics.latest(parseId(request.params)),
  }));

  app.post('/publications/:id/metrics', async (request, reply) => {
    const metrics = await analytics.saveManual(
      parseId(request.params),
      ManualMetricsInputSchema.parse(request.body),
    );
    return reply.code(201).send(metrics);
  });
}
