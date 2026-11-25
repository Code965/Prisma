import {
  defaultFormat,
  type Content,
  type ContentInput,
  type ContentUpdate,
} from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/error-handler.js';
import type { BrandService } from '../brands/service.js';
import type { IdeaService } from '../ideas/service.js';
import {
  countPublicationsOfVariants,
  insertVariant,
  listVariantsOfContents,
} from '../variants/repository.js';
import * as repo from './repository.js';
import * as ideaRepo from '../ideas/repository.js';

export function createContentService(db: DbExecutor, brands: BrandService, ideas: IdeaService) {
  async function get(id: number): Promise<Content> {
    const row = await repo.findContentRow(db, id);
    if (!row) throw new NotFoundError('Contenuto', id);
    const variants = await listVariantsOfContents(db, [id]);
    return repo.toContent(row, variants.get(id) ?? []);
  }

  async function list(brandId: number): Promise<Content[]> {
    await brands.ensureExists(brandId);
    const rows = await repo.listContentRows(db, brandId);
    const variants = await listVariantsOfContents(
      db,
      rows.map((row) => row.id),
    );
    return rows.map((row) => repo.toContent(row, variants.get(row.id) ?? []));
  }

  async function create(brandId: number, input: ContentInput): Promise<Content> {
    await brands.ensureExists(brandId);
    if (input.ideaId !== null) {
      const idea = await ideas.get(input.ideaId);
      if (idea.brandId !== brandId)
        throw new BusinessRuleError("L'idea appartiene a un altro brand");
    }

    const id = await db.transaction(async (tx) => {
      const contentId = await repo.insertContent(tx, {
        brandId,
        ideaId: input.ideaId,
        title: input.title,
      });
      for (const platform of input.platforms) {
        await insertVariant(tx, {
          contentId,
          platform,
          format: defaultFormat(platform),
          body: '',
          metadata: { hashtags: [] },
        });
      }
      return contentId;
    });

    if (input.ideaId !== null) await ideas.markInProgress(input.ideaId);
    return get(id);
  }

  async function update(id: number, input: ContentUpdate): Promise<Content> {
    await get(id);
    await repo.updateContentTitle(db, id, input.title);
    return get(id);
  }

  /** Un contenuto con pubblicazioni (anche annullate) resta per lo storico e le metriche. */
  async function remove(id: number): Promise<void> {
    const content = await get(id);
    const variantIds = content.variants.map((variant) => variant.id);
    if ((await countPublicationsOfVariants(db, variantIds)) > 0) {
      throw new ConflictError('Il contenuto ha pubblicazioni collegate e non si può eliminare');
    }
    await repo.deleteContent(db, id);
  }

  /**
   * Elimina un'idea e, se richiesto, i contenuti nati da lei che non sono mai usciti (nessuna
   * pubblicazione, nemmeno annullata). Quelli pubblicati o in coda restano, senza l'idea.
   * Tutto in una transazione.
   */
  async function removeIdea(
    ideaId: number,
    withDrafts: boolean,
  ): Promise<{ removedContents: number; keptContents: number }> {
    const idea = await ideas.get(ideaId);
    const rows = (await repo.listContentRows(db, idea.brandId)).filter((r) => r.ideaId === ideaId);
    const variants = await listVariantsOfContents(
      db,
      rows.map((r) => r.id),
    );
    const removable: number[] = [];
    if (withDrafts) {
      for (const row of rows) {
        const ids = (variants.get(row.id) ?? []).map((v) => v.id);
        if ((await countPublicationsOfVariants(db, ids)) === 0) removable.push(row.id);
      }
    }
    await db.transaction(async (tx) => {
      for (const id of removable) await repo.deleteContent(tx, id);
      await ideaRepo.deleteIdea(tx, ideaId);
    });
    return { removedContents: removable.length, keptContents: rows.length - removable.length };
  }

  return { get, list, create, update, remove, removeIdea };
}

export type ContentService = ReturnType<typeof createContentService>;
