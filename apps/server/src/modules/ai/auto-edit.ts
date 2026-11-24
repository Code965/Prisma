import {
  AUTO_EDIT_LIMITS,
  AutoEditPlanSchema,
  formatDurationMs,
  type AutoEditPlan,
  type AutoEditRequest,
  type ShortSegment,
} from '@prisma-app/shared';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { formatSegments } from './shorts.js';

/**
 * Risposta del modello controllata sulle frasi della richiesta: numeri esistenti e al massimo un
 * terzo delle frasi tolte. Gli errori tornano al modello, che ritenta (`completeValidatedJson`).
 */
export function autoEditPlanSchema(segments: readonly ShortSegment[]) {
  const valid = (index: number) => index >= 0 && index < segments.length;
  const range = `usa numeri da 0 a ${segments.length - 1}`;
  return AutoEditPlanSchema.superRefine((plan, ctx) => {
    const check = (index: number, path: (string | number)[]) => {
      if (!valid(index))
        ctx.addIssue({ code: 'custom', path, message: `Frase ${index} inesistente: ${range}` });
    };
    plan.removeSegments.forEach((item, i) => check(item.segment, ['removeSegments', i, 'segment']));
    plan.fillers.forEach((item, i) => check(item.segment, ['fillers', i, 'segment']));
    plan.keywords.forEach((item, i) => check(item.segment, ['keywords', i, 'segment']));
    plan.emphasis.forEach((index, i) => check(index, ['emphasis', i]));
    if (plan.hook) check(plan.hook.segment, ['hook', 'segment']);
    const maxRemoved = Math.max(1, Math.floor(segments.length / 3));
    if (plan.removeSegments.length > maxRemoved) {
      ctx.addIssue({
        code: 'custom',
        path: ['removeSegments'],
        message: `Togli al massimo ${maxRemoved} frasi su ${segments.length}`,
      });
    }
  });
}

/**
 * «Monta con l'AI» (fase 6a): una chiamata al modello propone tagli, hook, parole chiave e frasi
 * da enfatizzare. Non salva nulla: il desktop applica la proposta al progetto video
 * (`applyAutoEdit`), dove l'autore la rivede.
 */
export function createAutoEditService(deps: {
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  voice: (brandId: number) => Promise<string>;
}) {
  return {
    async plan(input: AutoEditRequest): Promise<AutoEditPlan> {
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const brand = await deps.brands.get(input.brandId);
      return llm.completeJson({
        schema: autoEditPlanSchema(input.segments),
        maxTokens: 4096,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: deps.prompts.render('video-auto-edit.system', {
              brandName: brand.name,
              voice: await deps.voice(brand.id),
              hookMaxChars: String(AUTO_EDIT_LIMITS.hookMaxChars),
            }),
          },
          {
            role: 'user',
            content: deps.prompts.render('video-auto-edit.user', {
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

export type AutoEditService = ReturnType<typeof createAutoEditService>;
