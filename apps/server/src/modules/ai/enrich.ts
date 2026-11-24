import {
  EnrichPlanSchema,
  formatDurationMs,
  type EnrichPlan,
  type EnrichRequest,
  type ShortSegment,
} from '@prisma-app/shared';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { formatSegments } from './shorts.js';

/** Quante schede e quanti B-roll al massimo per la durata del video. */
export function enrichLimits(durationMs: number): { overlays: number; broll: number } {
  return {
    overlays: Math.max(1, Math.ceil(durationMs / 12_000)),
    broll: Math.max(1, Math.ceil(durationMs / 8000)),
  };
}

/**
 * Risposta del modello controllata sulle frasi: numeri esistenti, niente B-roll sulla prima
 * frase, una scheda per frase, quantità proporzionate alla durata. Gli errori tornano al modello.
 */
export function enrichPlanSchema(segments: readonly ShortSegment[], durationMs: number) {
  const limits = enrichLimits(durationMs);
  const range = `usa numeri da 0 a ${segments.length - 1}`;
  const valid = (index: number) => index >= 0 && index < segments.length;
  return EnrichPlanSchema.superRefine((plan, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    plan.overlays.forEach((item, i) => {
      if (!valid(item.segment)) {
        issue(['overlays', i, 'segment'], `Frase ${item.segment} inesistente: ${range}`);
      }
      if (item.kind === 'code' && !item.code.trim()) {
        issue(['overlays', i, 'code'], 'Una scheda "code" ha bisogno del codice');
      }
      if (item.kind === 'list' && item.body.split('\n').filter((l) => l.trim()).length < 2) {
        issue(['overlays', i, 'body'], 'Una scheda "list" ha almeno 2 punti, uno per riga');
      }
    });
    if (new Set(plan.overlays.map((o) => o.segment)).size !== plan.overlays.length) {
      issue(['overlays'], 'Mai due schede sulla stessa frase');
    }
    if (plan.overlays.length > limits.overlays) {
      issue(['overlays'], `Al massimo ${limits.overlays} schede per questo video`);
    }
    plan.broll.forEach((item, i) => {
      if (!valid(item.segment)) {
        issue(['broll', i, 'segment'], `Frase ${item.segment} inesistente: ${range}`);
      } else if (item.segment === 0) {
        issue(['broll', i, 'segment'], 'Niente B-roll sulla frase 0');
      }
    });
    if (plan.broll.length > limits.broll) {
      issue(['broll'], `Al massimo ${limits.broll} B-roll per questo video`);
    }
  });
}

/**
 * «Aggiungi B-roll e testi» (fase 6d): il modello propone schede e ricerche di B-roll. Non salva
 * nulla: il desktop cerca i file, li aggiunge al progetto e l'autore li rivede.
 */
export function createEnrichService(deps: {
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  voice: (brandId: number) => Promise<string>;
}) {
  return {
    async plan(input: EnrichRequest): Promise<EnrichPlan> {
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const brand = await deps.brands.get(input.brandId);
      return llm.completeJson({
        schema: enrichPlanSchema(input.segments, input.durationMs),
        maxTokens: 4096,
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content: deps.prompts.render('video-enrich.system', {
              brandName: brand.name,
              voice: await deps.voice(brand.id),
            }),
          },
          {
            role: 'user',
            content: deps.prompts.render('video-enrich.user', {
              videoTitle: input.videoTitle,
              duration: formatDurationMs(input.durationMs),
              segments: formatSegments(input.segments),
            }),
          },
        ],
      });
    },
  };
}

export type EnrichService = ReturnType<typeof createEnrichService>;
