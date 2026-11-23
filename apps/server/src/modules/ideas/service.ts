import type { Idea, IdeaInput, IdeaListQuery, IdeaUpdate } from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { NotFoundError } from '../../http/error-handler.js';
import type { BrandService } from '../brands/service.js';
import type { TagService } from '../tags/service.js';
import * as repo from './repository.js';

export function createIdeaService(db: DbExecutor, brands: BrandService, tags: TagService) {
  async function get(id: number): Promise<Idea> {
    const idea = await repo.findIdea(db, id);
    if (!idea) throw new NotFoundError('Idea', id);
    return idea;
  }

  return {
    list: async (brandId: number, query: IdeaListQuery): Promise<Idea[]> => {
      await brands.ensureExists(brandId);
      return repo.listIdeas(db, brandId, query);
    },
    get,
    create: async (brandId: number, input: IdeaInput): Promise<Idea> => {
      await brands.ensureExists(brandId);
      await tags.assertBelongToBrand(brandId, input.tagIds);
      const id = await db.transaction(async (tx) => {
        const ideaId = await repo.insertIdea(tx, {
          brandId,
          text: input.text,
          source: input.source,
          targetPlatforms: input.targetPlatforms,
        });
        await repo.replaceIdeaTags(tx, ideaId, input.tagIds);
        return ideaId;
      });
      return get(id);
    },
    update: async (id: number, input: IdeaUpdate): Promise<Idea> => {
      const current = await get(id);
      const { tagIds, ...fields } = input;
      if (tagIds) await tags.assertBelongToBrand(current.brandId, tagIds);
      await db.transaction(async (tx) => {
        await repo.updateIdea(tx, id, fields);
        if (tagIds) await repo.replaceIdeaTags(tx, id, tagIds);
      });
      return get(id);
    },
    /** Le idee già trasformate in contenuti restano collegate: il contenuto perde solo il riferimento. */
    remove: async (id: number): Promise<void> => {
      await get(id);
      await repo.deleteIdea(db, id);
    },
    markInProgress: async (id: number): Promise<void> => {
      const idea = await get(id);
      if (idea.status === 'nuova') await repo.updateIdea(db, id, { status: 'in_lavorazione' });
    },
  };
}

export type IdeaService = ReturnType<typeof createIdeaService>;
