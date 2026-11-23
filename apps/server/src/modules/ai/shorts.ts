import {
  PLATFORM_LABELS,
  SHORT_LIMITS,
  SHORT_VARIANT_FORMAT,
  formatDurationMs,
  type GenerateShortsRequest,
  type GenerateShortsResult,
  type ShortPlatform,
  type ShortSegment,
} from '@prisma-app/shared';
import { z } from 'zod';
import type { DbExecutor } from '../../db/executor.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { hashtags, optionalText, toMetadata } from '../../llm/schemas.js';
import { LlmNotConfiguredError, type LlmProvider } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { insertContent } from '../contents/repository.js';
import type { ContentService } from '../contents/service.js';
import { insertRevision, insertVariant } from '../variants/repository.js';

const ShortVariantSchema = z.object({
  platform: z.string(),
  body: z.string().trim().min(1),
  hashtags,
  title: optionalText,
  description: optionalText,
});

const ShortMomentSchema = z.object({
  firstSegment: z.int().nonnegative(),
  lastSegment: z.int().nonnegative(),
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
  variants: z.array(ShortVariantSchema).min(1),
});
type ShortMoment = z.infer<typeof ShortMomentSchema>;

/**
 * Risposta del modello, controllata contro la richiesta: frasi esistenti, durata nei limiti,
 * momenti che non si sovrappongono e un testo per ogni piattaforma. Gli errori tornano al
 * modello, che ritenta (`completeValidatedJson`).
 */
export function generatedShortsSchema(
  segments: readonly ShortSegment[],
  platforms: readonly ShortPlatform[],
  count: number,
) {
  return z
    .object({ shorts: z.array(ShortMomentSchema).min(1).max(count) })
    .superRefine((value, ctx) => {
      const taken: Array<[number, number]> = [];
      value.shorts.forEach((moment, index) => {
        const path = ['shorts', index];
        const first = segments[moment.firstSegment];
        const last = segments[moment.lastSegment];
        if (!first || !last || moment.lastSegment < moment.firstSegment) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `Frasi ${moment.firstSegment}-${moment.lastSegment} non valide: usa numeri da 0 a ${segments.length - 1}, con firstSegment ≤ lastSegment`,
          });
          return;
        }
        const durationMs = last.endMs - first.startMs;
        if (durationMs < SHORT_LIMITS.minMs || durationMs > SHORT_LIMITS.maxMs) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `Il momento dura ${Math.round(durationMs / 1000)} s: deve durare tra ${SHORT_LIMITS.minMs / 1000} e ${SHORT_LIMITS.maxMs / 1000} s`,
          });
        }
        if (taken.some(([a, b]) => moment.firstSegment <= b && moment.lastSegment >= a)) {
          ctx.addIssue({ code: 'custom', path, message: 'Si sovrappone a un altro momento' });
        }
        taken.push([moment.firstSegment, moment.lastSegment]);
        const missing = platforms.filter((p) => !moment.variants.some((v) => v.platform === p));
        if (missing.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'variants'],
            message: `Manca il testo per: ${missing.join(', ')}`,
          });
        }
      });
    });
}

interface ShortsAiDeps {
  db: DbExecutor;
  llm: LlmProvider | null;
  prompts: PromptLibrary;
  brands: BrandService;
  contents: ContentService;
  voice: (brandId: number) => Promise<string>;
}

/** Le frasi numerate con i loro orari, come le legge il modello. */
export function formatSegments(segments: readonly ShortSegment[]): string {
  return segments
    .map((s, i) => `[${i}] ${formatDurationMs(s.startMs)}–${formatDurationMs(s.endMs)} ${s.text}`)
    .join('\n');
}

export function createShortsAiService(deps: ShortsAiDeps) {
  const { db, prompts, brands, contents, voice } = deps;

  /**
   * «Genera Short da video lungo»: una chiamata sceglie i momenti e scrive i testi, poi
   * un'unica transazione crea un contenuto in bozza per momento. Il video lo taglia il desktop.
   */
  async function generate(input: GenerateShortsRequest): Promise<GenerateShortsResult> {
    if (!deps.llm) throw new LlmNotConfiguredError();
    const brand = await brands.get(input.brandId);
    const count = input.count ?? SHORT_LIMITS.maxCount;
    const { segments, platforms } = input;
    const generated = await deps.llm.completeJson({
      schema: generatedShortsSchema(segments, platforms, count),
      maxTokens: 8192,
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-shorts.system', {
            brandName: brand.name,
            voice: await voice(brand.id),
            minSeconds: String(SHORT_LIMITS.minMs / 1000),
            maxSeconds: String(SHORT_LIMITS.maxMs / 1000),
          }),
        },
        {
          role: 'user',
          content: prompts.render('generate-shorts.user', {
            videoTitle: input.videoTitle,
            duration: formatDurationMs(input.durationMs),
            count: String(count),
            platforms: platforms.map((p) => `${p} (${PLATFORM_LABELS[p]})`).join(', '),
            guidelines: platforms.map((p) => prompts.render(`platforms/${p}`)).join('\n\n'),
            segments: formatSegments(segments),
          }),
        },
      ],
    });

    const created = await db.transaction(async (tx) => {
      const result: Array<{ contentId: number; moment: ShortMoment }> = [];
      for (const moment of generated.shorts) {
        const contentId = await insertContent(tx, {
          brandId: brand.id,
          ideaId: null,
          title: moment.title,
        });
        for (const platform of platforms) {
          const draft = moment.variants.find((v) => v.platform === platform)!;
          const metadata = toMetadata({ ...draft, firstComment: undefined });
          const variantId = await insertVariant(tx, {
            contentId,
            platform,
            format: SHORT_VARIANT_FORMAT[platform],
            body: draft.body,
            metadata,
          });
          await insertRevision(tx, {
            variantId,
            body: draft.body,
            metadata,
            source: 'llm_generate',
          });
        }
        result.push({ contentId, moment });
      }
      return result;
    });

    return {
      shorts: await Promise.all(
        created.map(async ({ contentId, moment }) => ({
          content: await contents.get(contentId),
          startMs: segments[moment.firstSegment]!.startMs,
          endMs: segments[moment.lastSegment]!.endMs,
          reason: moment.reason,
        })),
      ),
    };
  }

  return { generate };
}

export type ShortsAiService = ReturnType<typeof createShortsAiService>;
