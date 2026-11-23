import {
  InvalidTransitionError,
  PLATFORM_LABELS,
  canTransitionVariant,
  defaultFormat,
  type ChatMessage,
  type Content,
  type EditVariantRequest,
  type EditVariantResult,
  type GenerateContent,
  type Idea,
  type Platform,
  type VariantMetadata,
} from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { NotFoundError, VersionConflictError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { sanitizeArticleHtml } from '../../content/article-html.js';
import {
  EditedVariantSchema,
  GeneratedArticleSchema,
  GeneratedContentSchema,
  toMetadata,
  type GeneratedContent,
} from '../../llm/schemas.js';
import { LlmError, LlmNotConfiguredError, type LlmProvider } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { findContentRow, insertContent } from '../contents/repository.js';
import type { ContentService } from '../contents/service.js';
import type { IdeaService } from '../ideas/service.js';
import {
  findVariantRow,
  insertRevision,
  insertVariant,
  toVariant,
  updateVariantIfVersion,
} from '../variants/repository.js';
import { applyVariantTransition } from '../variants/transitions.js';
import * as chat from './chat-repository.js';

const HISTORY_LIMIT = 10;

interface BrandVoice {
  name: string;
  voice: string;
}

interface AiServiceDeps {
  db: DbExecutor;
  llm: LlmProvider | null;
  prompts: PromptLibrary;
  now: () => Date;
  brands: BrandService;
  ideas: IdeaService;
  contents: ContentService;
  /** Regole ed esempi della voce del brand, già formattati per i prompt. */
  voice: (brandId: number) => Promise<string>;
}

export function createAiService(deps: AiServiceDeps) {
  const { db, prompts, now, brands, ideas, contents, voice } = deps;

  function requireLlm(): LlmProvider {
    if (!deps.llm) throw new LlmNotConfiguredError();
    return deps.llm;
  }

  function guidelines(platforms: readonly Platform[]): string {
    return platforms.map((platform) => prompts.render(`platforms/${platform}`)).join('\n\n');
  }

  async function generateSocial(
    llm: LlmProvider,
    brand: BrandVoice,
    idea: Idea,
    platforms: Platform[],
  ): Promise<{ title: string; drafts: Map<Platform, Draft> }> {
    const generated = await llm.completeJson({
      schema: GeneratedContentSchema,
      maxTokens: 8192,
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-variants.system', {
            brandName: brand.name,
            voice: brand.voice,
          }),
        },
        {
          role: 'user',
          content: prompts.render('generate-variants.user', {
            ideaText: idea.text,
            tags: tagList(idea),
            platforms: platforms.map((p) => PLATFORM_LABELS[p]).join(', '),
            guidelines: guidelines(platforms),
          }),
        },
      ],
    });
    return { title: generated.title, drafts: pickRequestedVariants(generated, platforms) };
  }

  /** L'articolo del blog è lungo: una chiamata dedicata, con HTML ripulito prima di salvarlo. */
  async function generateArticle(llm: LlmProvider, brand: BrandVoice, idea: Idea): Promise<Draft> {
    const article = await llm.completeJson({
      schema: GeneratedArticleSchema,
      maxTokens: 8192,
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-article.system', {
            brandName: brand.name,
            voice: brand.voice,
            guidelines: guidelines(['blog']),
          }),
        },
        {
          role: 'user',
          content: prompts.render('generate-article.user', {
            ideaText: idea.text,
            tags: tagList(idea),
          }),
        },
      ],
    });
    const body = sanitizeArticleHtml(article.body);
    if (!body) throw new LlmError("Il modello non ha prodotto il testo dell'articolo");
    return {
      body,
      hashtags: article.hashtags,
      title: article.title,
      description: article.description,
      firstComment: undefined,
    };
  }

  /**
   * "Genera contenuti": una chiamata per le piattaforme social e, se richiesto, una per
   * l'articolo del blog; poi un'unica transazione. Se una chiamata fallisce non si salva nulla.
   */
  async function generate(input: GenerateContent): Promise<Content> {
    const llm = requireLlm();
    const idea = await ideas.get(input.ideaId);
    const brand = await brands.get(idea.brandId);
    const writer: BrandVoice = { name: brand.name, voice: await voice(brand.id) };
    const socialPlatforms = input.platforms.filter((p) => p !== 'blog');
    const wantsArticle = input.platforms.includes('blog');

    const [social, article] = await Promise.all([
      socialPlatforms.length > 0 ? generateSocial(llm, writer, idea, socialPlatforms) : null,
      wantsArticle ? generateArticle(llm, writer, idea) : null,
    ]);
    const drafts = new Map(social?.drafts);
    if (article) drafts.set('blog', article);
    const title = social?.title ?? article?.title ?? idea.text.slice(0, 200);

    const contentId = await db.transaction(async (tx) => {
      const id = await insertContent(tx, { brandId: brand.id, ideaId: idea.id, title });
      for (const platform of input.platforms) {
        const draft = drafts.get(platform)!;
        const metadata = toMetadata(draft);
        const variantId = await insertVariant(tx, {
          contentId: id,
          platform,
          format: defaultFormat(platform),
          body: draft.body,
          metadata,
        });
        await insertRevision(tx, { variantId, body: draft.body, metadata, source: 'llm_generate' });
      }
      return id;
    });

    await ideas.markInProgress(idea.id);
    return contents.get(contentId);
  }

  /** Modifica "scrivendo": il modello riscrive la bozza, che torna `bozza` e finisce nello storico. */
  async function edit(variantId: number, input: EditVariantRequest): Promise<EditVariantResult> {
    const llm = requireLlm();
    const row = await findVariantRow(db, variantId);
    if (!row) throw new NotFoundError('Variant', variantId);
    if (row.version !== input.expectedVersion) throw new VersionConflictError('Variant', variantId);
    // Si controlla prima di chiamare il modello, per non pagare una risposta che non si può salvare.
    if (!canTransitionVariant(row.status, 'edit')) {
      throw new InvalidTransitionError('variant', row.status, 'edit');
    }
    const content = await findContentRow(db, row.contentId);
    if (!content) throw new NotFoundError('Contenuto', row.contentId);
    const brand = await brands.get(content.brandId);
    const history = await chat.recentVariantMessages(db, variantId, HISTORY_LIMIT);
    const brandVoice = await voice(brand.id);

    const edited = await llm.completeJson({
      schema: EditedVariantSchema,
      // Un articolo del blog va restituito per intero: serve più spazio di un post.
      maxTokens: row.platform === 'blog' ? 8192 : undefined,
      messages: [
        {
          role: 'system',
          content: prompts.render('edit-variant.system', {
            brandName: brand.name,
            platformLabel: PLATFORM_LABELS[row.platform],
            guidelines: guidelines([row.platform]),
            voice: brandVoice,
          }),
        },
        {
          role: 'user',
          content: prompts.render('edit-variant.user', {
            contentTitle: content.title,
            currentVariant: JSON.stringify(editableFields(row.body, row.metadata), null, 2),
            history: formatHistory(history),
            instruction: input.instruction,
          }),
        },
      ],
    });
    // La chat modifica il testo: copertina e slide del carosello restano quelle salvate.
    const metadata = toMetadata(edited, {
      coverAssetId: row.metadata.coverAssetId,
      carousel: row.metadata.carousel,
    });
    const body = row.platform === 'blog' ? sanitizeArticleHtml(edited.body) : edited.body;

    const revisionId = await db.transaction(async (tx) => {
      // Ricontrolla la versione: l'utente potrebbe aver modificato a mano mentre il modello rispondeva.
      await applyVariantTransition(tx, variantId, 'edit', {
        expectedVersion: input.expectedVersion,
        now: now(),
      });
      const saved = await updateVariantIfVersion(tx, variantId, input.expectedVersion + 1, {
        body,
        metadata,
      });
      if (!saved) throw new VersionConflictError('Variant', variantId);
      const id = await insertRevision(tx, {
        variantId,
        body,
        metadata,
        source: 'llm_edit',
        instruction: input.instruction,
      });
      const base = { contentId: row.contentId, variantId };
      await chat.insertChatMessage(tx, { ...base, role: 'user', text: input.instruction });
      await chat.insertChatMessage(tx, {
        ...base,
        role: 'assistant',
        text: edited.reply,
        revisionId: id,
      });
      return id;
    });

    const updated = await findVariantRow(db, variantId);
    return {
      variant: toVariant(updated!),
      reply: edited.reply,
      before: row.body,
      after: body,
      revisionId,
    };
  }

  async function chatHistory(contentId: number): Promise<ChatMessage[]> {
    await contents.get(contentId);
    return chat.listChatMessages(db, contentId);
  }

  return { generate, edit, chatHistory };
}

type Draft =
  GeneratedContent['variants'][number] | Omit<GeneratedContent['variants'][number], 'platform'>;

function tagList(idea: Idea): string {
  return idea.tags.map((tag) => tag.name).join(', ') || 'nessuno';
}

function pickRequestedVariants(
  generated: GeneratedContent,
  platforms: readonly Platform[],
): Map<Platform, Draft> {
  const byPlatform = new Map(generated.variants.map((variant) => [variant.platform, variant]));
  const missing = platforms.filter((platform) => !byPlatform.has(platform));
  if (missing.length > 0) {
    throw new LlmError(`Il modello non ha prodotto la bozza per: ${missing.join(', ')}`);
  }
  return byPlatform;
}

function formatHistory(messages: ChatMessage[]): string {
  if (messages.length === 0) return 'nessuna';
  return messages
    .map((message) => `${message.role === 'user' ? 'Autore' : 'Tu'}: ${message.text}`)
    .join('\n');
}

export type AiService = ReturnType<typeof createAiService>;

/** Campi testuali che la chat può riscrivere; il carosello ha un editor e una chat sue. */
function editableFields(body: string, metadata: VariantMetadata) {
  return {
    body,
    hashtags: metadata.hashtags,
    title: metadata.title,
    description: metadata.description,
    firstComment: metadata.firstComment,
  };
}
