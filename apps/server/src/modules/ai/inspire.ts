import {
  PLATFORM_LABELS,
  type IdeaInspiration,
  type InspirationSignals,
  type Inspiration,
  type InspireRequest,
  type Tag,
} from '@prisma-app/shared';
import { z } from 'zod';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import type { CompetitorsService } from '../competitors/service.js';
import type { TagService } from '../tags/service.js';
import { NotFoundError } from '../../http/error-handler.js';

/** Parole consecutive in comune con l'originale oltre le quali una frase è copiata. */
export const COPY_WORDS = 6;
/** Numeri piccoli (passi, parti) ammessi anche se non compaiono nei dati. */
const SMALL_NUMBER = 10;

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Il primo pezzo di `COPY_WORDS` parole di `text` che compare uguale in `source`, o null. */
export function copiedPhrase(text: string, source: string, size = COPY_WORDS): string | null {
  const original = ` ${words(source).join(' ')} `;
  const own = words(text);
  for (let i = 0; i + size <= own.length; i++) {
    const piece = own.slice(i, i + size).join(' ');
    if (original.includes(` ${piece} `)) return piece;
  }
  return null;
}

export const numbersIn = (text: string) =>
  [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/[.,]/g, ''));

/** I numeri del testo che non vengono dai dati (esclusi quelli piccoli: «tre passi»). */
export function inventedNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  return numbersIn(text).filter((n) => Number(n) > SMALL_NUMBER && !allowed.has(n));
}

/** Il post d'origine come lo vede il modello e come resta sull'idea. */
export interface InspirationInput {
  inspiration: IdeaInspiration;
  /** Titolo e testo dell'originale, per il prompt e per il controllo sulla copia. */
  text: string;
  format: string | null;
  signals: InspirationSignals | null;
}

/**
 * Risposta del modello, controllata contro l'originale: nessuna frase copiata, nessun numero
 * che non venga dai dati, argomento tra quelli ammessi. Gli errori tornano al modello.
 */
export function inspirationSchema(source: InspirationInput, topics: readonly string[] | null) {
  const text = (max: number) => z.string().trim().min(1).max(max);
  const allowed = new Set([...numbersIn(source.text), ...numbersIn(formatSignals(source.signals))]);
  return z
    .object({
      mechanism: z.object({
        hook: text(200),
        structure: z.array(text(160)).min(2).max(6),
        whyItWorked: text(500),
      }),
      idea: z.object({
        topic: text(80),
        text: text(600),
        hook: text(160),
      }),
    })
    .superRefine((value, ctx) => {
      const own: Array<[string[], string]> = [
        [['idea', 'text'], value.idea.text],
        [['idea', 'hook'], value.idea.hook],
        [['mechanism', 'hook'], value.mechanism.hook],
        [['mechanism', 'whyItWorked'], value.mechanism.whyItWorked],
        ...value.mechanism.structure.map(
          (step, i) => [['mechanism', 'structure', String(i)], step] as [string[], string],
        ),
      ];
      for (const [path, field] of own) {
        const copied = copiedPhrase(field, source.text);
        if (copied) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `Frase copiata dall'originale («${copied}»): riscrivi con parole tue, riusa solo la forma`,
          });
        }
      }
      for (const [path, field] of own) {
        const invented = inventedNumbers(field, allowed);
        if (invented.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `Numeri non presenti nei dati (${invented.join(', ')}): toglili`,
          });
        }
      }
      if (topics && !topics.some((t) => t.toLowerCase() === value.idea.topic.toLowerCase())) {
        ctx.addIssue({
          code: 'custom',
          path: ['idea', 'topic'],
          message: `L'argomento deve essere uno di: ${topics.join(', ')}`,
        });
      }
    });
}

/** Numeri salvati del post, per il prompt. */
export function formatSignals(signals: InspirationSignals | null): string {
  if (!signals) return 'nessun numero';
  const percent = (v: number) => `${(v * 100).toFixed(1)}%`;
  const parts = [
    signals.views !== null ? `visualizzazioni ${signals.views}` : null,
    signals.likes !== null ? `like ${signals.likes}` : null,
    signals.comments !== null ? `commenti ${signals.comments}` : null,
    signals.shares !== null ? `condivisioni ${signals.shares}` : null,
    signals.rate !== null && signals.basis
      ? `tasso di interazione ${percent(signals.rate)} sui ${signals.basis}`
      : null,
    signals.medianRate !== null ? `mediana del profilo ${percent(signals.medianRate)}` : null,
  ].filter(Boolean);
  return parts.join(', ') || 'nessun numero';
}

interface InspireDeps {
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  tags: TagService;
  competitors: Pick<CompetitorsService, 'postWithStats'>;
  voice: (brandId: number) => Promise<string>;
}

/**
 * «Ispirati» (fase 8c): una chiamata LLM che spiega il meccanismo del post d'origine e propone
 * un'idea sull'argomento del brand. Non salva nulla: l'idea si crea con `POST /brands/:id/ideas`
 * (con `inspiration`) e le bozze con `POST /contents/generate`, quindi restano in bozza.
 */
export function createInspireService(deps: InspireDeps) {
  const { prompts, brands, tags, competitors, voice } = deps;

  async function load(brandId: number, request: InspireRequest): Promise<InspirationInput> {
    const source = request.source;
    if (source.kind === 'testo') {
      const title = source.title?.trim() || source.text.replace(/\s+/g, ' ').slice(0, 120);
      return {
        inspiration: {
          kind: 'testo',
          competitorPostId: null,
          label: source.label?.trim() || 'Testo incollato',
          platform: source.platform ?? null,
          title,
          url: source.url ?? null,
        },
        text: [source.title, source.text].filter(Boolean).join('\n'),
        format: null,
        signals: null,
      };
    }
    const found = await competitors.postWithStats(source.postId);
    // Un post di un altro brand non si usa.
    if (found.competitor.brandId !== brandId) {
      throw new NotFoundError('Post del concorrente', source.postId);
    }
    const { post } = found;
    return {
      inspiration: {
        kind: 'concorrente',
        competitorPostId: post.id,
        label: found.competitor.name,
        platform: found.competitor.platform,
        title: post.title ?? (post.text ?? '').replace(/\s+/g, ' ').slice(0, 120),
        url: post.url,
      },
      text: [post.title, post.text].filter(Boolean).join('\n'),
      format: post.format,
      signals: {
        views: post.views,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        basis: found.basis,
        rate: found.rate,
        medianRate: found.medianRate,
      },
    };
  }

  function topicChoice(request: InspireRequest, brandTags: Tag[]) {
    if (request.tagId) {
      const tag = brandTags.find((t) => t.id === request.tagId);
      if (!tag) throw new NotFoundError('Tag', request.tagId);
      return { fixed: tag.name, choices: [tag.name] };
    }
    if (request.topic) return { fixed: request.topic, choices: null };
    return { fixed: null, choices: brandTags.length > 0 ? brandTags.map((t) => t.name) : null };
  }

  return {
    async inspire(brandId: number, request: InspireRequest): Promise<Inspiration> {
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const brand = await brands.get(brandId);
      const brandTags = await tags.list(brandId);
      const source = await load(brandId, request);
      const topic = topicChoice(request, brandTags);

      const generated = await llm.completeJson({
        schema: inspirationSchema(source, topic.fixed ? [topic.fixed] : topic.choices),
        messages: [
          {
            role: 'system',
            content: prompts.render('inspire.system', {
              brandName: brand.name,
              voice: await voice(brandId),
            }),
          },
          {
            role: 'user',
            content: prompts.render('inspire.user', {
              origin: [
                source.inspiration.label,
                source.inspiration.platform ? PLATFORM_LABELS[source.inspiration.platform] : null,
                source.format,
              ]
                .filter(Boolean)
                .join(' · '),
              original: source.text,
              numbers: formatSignals(source.signals),
              topic: topic.fixed
                ? `Usa esattamente questo argomento: ${topic.fixed}`
                : topic.choices
                  ? `Scegli l'argomento più adatto tra: ${topic.choices.join(', ')}`
                  : "Scegli un argomento tech adatto al brand, diverso da quello dell'originale se possibile",
            }),
          },
        ],
      });
      const tag = brandTags.find(
        (t) => t.name.toLowerCase() === generated.idea.topic.toLowerCase(),
      );
      return {
        inspiration: source.inspiration,
        signals: source.signals,
        mechanism: generated.mechanism,
        idea: { ...generated.idea, tagId: tag?.id ?? null },
        model: llm.name,
      };
    },
  };
}

export type InspireService = ReturnType<typeof createInspireService>;
