import {
  CAROUSEL_PLATFORMS,
  InvalidTransitionError,
  PLATFORM_LABELS,
  canTransitionVariant,
  formatForCarousel,
  type Carousel,
  type EditCarouselRequest,
  type EditCarouselResult,
  type GenerateCarouselRequest,
  type Variant,
} from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import {
  BusinessRuleError,
  NotFoundError,
  VersionConflictError,
} from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { EditedCarouselSchema, GeneratedCarouselSchema } from '../../llm/schemas.js';
import { LlmNotConfiguredError, type LlmProvider } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { findContentRow } from '../contents/repository.js';
import {
  findVariantRow,
  insertRevision,
  toVariant,
  updateVariantIfVersion,
} from '../variants/repository.js';
import { applyVariantTransition } from '../variants/transitions.js';

interface CarouselAiDeps {
  db: DbExecutor;
  llm: LlmProvider | null;
  prompts: PromptLibrary;
  now: () => Date;
  brands: BrandService;
  voice: (brandId: number) => Promise<string>;
}

type VariantRow = NonNullable<Awaited<ReturnType<typeof findVariantRow>>>;

/**
 * Generazione e modifica «scrivendo» delle slide (editor carosello). Le slide salvate passano
 * dalla transizione `edit` come ogni altra modifica: la variant torna bozza e resta la revisione.
 */
export function createCarouselAiService(deps: CarouselAiDeps) {
  const { db, prompts, now, brands, voice } = deps;

  function requireLlm(): LlmProvider {
    if (!deps.llm) throw new LlmNotConfiguredError();
    return deps.llm;
  }

  /** Controlli prima di chiamare il modello, per non pagare risposte che non si possono salvare. */
  async function loadEditable(variantId: number, expectedVersion: number) {
    const row = await findVariantRow(db, variantId);
    if (!row) throw new NotFoundError('Variant', variantId);
    if (row.version !== expectedVersion) throw new VersionConflictError('Variant', variantId);
    if (!CAROUSEL_PLATFORMS.includes(row.platform)) {
      throw new BusinessRuleError(`${PLATFORM_LABELS[row.platform]} non pubblica caroselli`);
    }
    if (!canTransitionVariant(row.status, 'edit')) {
      throw new InvalidTransitionError('variant', row.status, 'edit');
    }
    const content = await findContentRow(db, row.contentId);
    if (!content) throw new NotFoundError('Contenuto', row.contentId);
    const brand = await brands.get(content.brandId);
    return { row, content, brand, voice: await voice(brand.id) };
  }

  async function save(
    row: VariantRow,
    expectedVersion: number,
    carousel: Carousel,
    instruction: string,
  ): Promise<Variant> {
    const metadata = { ...row.metadata, carousel };
    await db.transaction(async (tx) => {
      await applyVariantTransition(tx, row.id, 'edit', { expectedVersion, now: now() });
      const saved = await updateVariantIfVersion(tx, row.id, expectedVersion + 1, {
        metadata,
        format: formatForCarousel(row.platform, row.format, row.metadata, metadata),
      });
      if (!saved) throw new VersionConflictError('Variant', row.id);
      await insertRevision(tx, {
        variantId: row.id,
        body: row.body,
        metadata,
        source: 'llm_edit',
        instruction,
      });
    });
    return toVariant((await findVariantRow(db, row.id))!);
  }

  async function generate(variantId: number, input: GenerateCarouselRequest): Promise<Variant> {
    const llm = requireLlm();
    const ctx = await loadEditable(variantId, input.expectedVersion);
    if (!ctx.row.body.trim()) {
      throw new BusinessRuleError('Scrivi prima il testo del post: le slide si ricavano da lì');
    }
    const generated = await llm.completeJson({
      schema: GeneratedCarouselSchema,
      maxTokens: 4096,
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-carousel.system', {
            brandName: ctx.brand.name,
            platformLabel: PLATFORM_LABELS[ctx.row.platform],
            voice: ctx.voice,
          }),
        },
        {
          role: 'user',
          content: prompts.render('generate-carousel.user', {
            contentTitle: ctx.content.title,
            body: ctx.row.body,
          }),
        },
      ],
    });
    const carousel: Carousel = {
      template: ctx.row.metadata.carousel?.template ?? 'scuro',
      kicker: generated.kicker,
      slides: generated.slides,
    };
    return save(ctx.row, input.expectedVersion, carousel, 'Crea il carosello dal testo del post');
  }

  async function edit(variantId: number, input: EditCarouselRequest): Promise<EditCarouselResult> {
    const llm = requireLlm();
    const ctx = await loadEditable(variantId, input.expectedVersion);
    const current = ctx.row.metadata.carousel;
    if (!current) throw new BusinessRuleError('La variant non ha ancora un carosello');
    if (input.slideIndex >= current.slides.length) {
      throw new BusinessRuleError(`La slide ${input.slideIndex + 1} non esiste`);
    }
    const slideNumber = String(input.slideIndex + 1);
    const edited = await llm.completeJson({
      schema: EditedCarouselSchema,
      maxTokens: 4096,
      messages: [
        {
          role: 'system',
          content: prompts.render('edit-carousel.system', {
            brandName: ctx.brand.name,
            platformLabel: PLATFORM_LABELS[ctx.row.platform],
            slideNumber,
            voice: ctx.voice,
          }),
        },
        {
          role: 'user',
          content: prompts.render('edit-carousel.user', {
            contentTitle: ctx.content.title,
            carousel: JSON.stringify({ kicker: current.kicker, slides: current.slides }, null, 2),
            slideNumber,
            instruction: input.instruction,
          }),
        },
      ],
    });
    if (!edited.slides) {
      return { reply: edited.reply, variant: null, proposals: edited.proposals };
    }
    const carousel: Carousel = {
      template: current.template,
      kicker: edited.kicker ?? current.kicker,
      slides: edited.slides,
    };
    const variant = await save(ctx.row, input.expectedVersion, carousel, input.instruction);
    return { reply: edited.reply, variant, proposals: [] };
  }

  return { generate, edit };
}

export type CarouselAiService = ReturnType<typeof createCarouselAiService>;
