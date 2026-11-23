import type { Brand, BrandInput, BrandUpdate } from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { NotFoundError } from '../../http/error-handler.js';
import * as repo from './repository.js';

export function createBrandService(db: DbExecutor) {
  async function get(id: number): Promise<Brand> {
    const brand = await repo.findBrand(db, id);
    if (!brand) throw new NotFoundError('Brand', id);
    return brand;
  }

  return {
    list: () => repo.listBrands(db),
    get,
    /** Usato dagli altri moduli per verificare che il brand esista prima di scriverci. */
    ensureExists: async (id: number): Promise<void> => {
      await get(id);
    },
    create: async (input: BrandInput): Promise<Brand> => get(await repo.insertBrand(db, input)),
    update: async (id: number, input: BrandUpdate): Promise<Brand> => {
      await get(id);
      await repo.updateBrand(db, id, input);
      return get(id);
    },
  };
}

export type BrandService = ReturnType<typeof createBrandService>;
