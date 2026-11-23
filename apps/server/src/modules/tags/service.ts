import type { Tag, TagInput } from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { BusinessRuleError, NotFoundError } from '../../http/error-handler.js';
import type { BrandService } from '../brands/service.js';
import * as repo from './repository.js';

export function createTagService(db: DbExecutor, brands: BrandService) {
  async function get(id: number): Promise<Tag> {
    const tag = await repo.findTag(db, id);
    if (!tag) throw new NotFoundError('Tag', id);
    return tag;
  }

  return {
    list: async (brandId: number): Promise<Tag[]> => {
      await brands.ensureExists(brandId);
      return repo.listTags(db, brandId);
    },
    create: async (brandId: number, input: TagInput): Promise<Tag> => {
      await brands.ensureExists(brandId);
      return get(await repo.insertTag(db, brandId, input.name));
    },
    remove: async (id: number): Promise<void> => {
      await get(id);
      await repo.deleteTag(db, id);
    },
    /** Verifica che tutti i tag indicati esistano e appartengano al brand. */
    assertBelongToBrand: async (brandId: number, ids: readonly number[]): Promise<void> => {
      const unique = [...new Set(ids)];
      const found = await repo.countTagsOfBrand(db, brandId, unique);
      if (found !== unique.length)
        throw new BusinessRuleError('Uno o più tag non appartengono al brand');
    },
  };
}

export type TagService = ReturnType<typeof createTagService>;
