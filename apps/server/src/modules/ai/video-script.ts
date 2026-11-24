import {
  VIDEO_SCRIPT_LIMITS,
  countWords,
  type VideoScript,
  type VideoScriptRequest,
} from '@prisma-app/shared';
import { z } from 'zod';
import type { DbExecutor } from '../../db/executor.js';
import { BusinessRuleError, NotFoundError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { GeneratedSlideSchema } from '../../llm/schemas.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { findContentRow } from '../contents/repository.js';
import type { IdeaService } from '../ideas/service.js';
import { findVariantRow } from '../variants/repository.js';

const L = VIDEO_SCRIPT_LIMITS;

/**
 * Risposta del modello: scene nei limiti e lunghezza totale della narrazione vicina ai 45 s.
 * Gli errori tornano al modello, che ritenta (`completeValidatedJson`).
 */
export const GeneratedVideoScriptSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kicker: z
      .string()
      .nullish()
      .transform((value) => (value ?? '').trim().slice(0, 40)),
    scenes: z
      .array(
        z.object({
          narration: z.string().trim().min(1).max(L.narrationMax),
          slide: GeneratedSlideSchema,
        }),
      )
      .min(L.minScenes)
      .max(L.maxScenes),
  })
  .superRefine((value, ctx) => {
    const words = value.scenes.reduce((t, s) => t + countWords(s.narration), 0);
    if (words < L.minWords || words > L.maxWords) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenes'],
        message: `La narrazione ha ${words} parole: ne servono tra ${L.minWords} e ${L.maxWords}`,
      });
    }
  });

/** Testo semplice da un articolo HTML del blog (i social sono già testo). */
export function plainText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * «Crea video dall'idea» (fase 6c): il copione con le slide, da un'idea o dal testo di una bozza.
 * Non salva nulla: il desktop crea il video e lo apre nell'editor.
 */
export function createVideoScriptService(deps: {
  db: DbExecutor;
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  ideas: IdeaService;
  voice: (brandId: number) => Promise<string>;
}) {
  async function source(input: VideoScriptRequest) {
    if ('ideaId' in input) {
      const idea = await deps.ideas.get(input.ideaId);
      return { brandId: idea.brandId, label: 'Idea da trasformare in video', text: idea.text };
    }
    const row = await findVariantRow(deps.db, input.variantId);
    if (!row) throw new NotFoundError('Variant', input.variantId);
    const content = await findContentRow(deps.db, row.contentId);
    if (!content) throw new NotFoundError('Contenuto', row.contentId);
    const body = row.platform === 'blog' ? plainText(row.body) : row.body;
    return {
      brandId: content.brandId,
      label: `Post «${content.title}» da trasformare in video`,
      text: body,
    };
  }

  return {
    async generate(input: VideoScriptRequest): Promise<VideoScript> {
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const from = await source(input);
      if (!from.text.trim()) {
        throw new BusinessRuleError('Il testo è vuoto: scrivi prima qualcosa da raccontare');
      }
      const brand = await deps.brands.get(from.brandId);
      const generated = await llm.completeJson({
        schema: GeneratedVideoScriptSchema,
        maxTokens: 4096,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: deps.prompts.render('generate-video-script.system', {
              brandName: brand.name,
              voice: await deps.voice(brand.id),
              targetSeconds: String(L.targetSeconds),
              minScenes: String(L.minScenes),
              maxScenes: String(L.maxScenes),
              minWords: String(L.minWords),
              maxWords: String(L.maxWords),
              targetWords: String(Math.round(L.targetSeconds * L.wordsPerSecond)),
            }),
          },
          {
            role: 'user',
            content: deps.prompts.render('generate-video-script.user', {
              sourceLabel: from.label,
              text: from.text.slice(0, 8000),
            }),
          },
        ],
      });
      return { brandId: brand.id, ...generated };
    },
  };
}

export type VideoScriptService = ReturnType<typeof createVideoScriptService>;
