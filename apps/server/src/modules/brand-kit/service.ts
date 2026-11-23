import {
  DEFAULT_BRAND_KIT,
  type BrandKit,
  type VoiceExample,
  type VoiceExampleInput,
} from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { NotFoundError } from '../../http/error-handler.js';
import type { BrandService } from '../brands/service.js';
import * as repo from './repository.js';
import { VOICE_PROMPT_EXAMPLES, formatVoice } from './voice.js';

export function createBrandKitService(db: DbExecutor, brands: BrandService) {
  async function getKit(brandId: number): Promise<BrandKit> {
    await brands.ensureExists(brandId);
    return (await repo.findKit(db, brandId)) ?? DEFAULT_BRAND_KIT;
  }

  return {
    getKit,
    saveKit: async (brandId: number, kit: BrandKit): Promise<BrandKit> => {
      await brands.ensureExists(brandId);
      await repo.saveKit(db, brandId, kit);
      return getKit(brandId);
    },
    listVoiceExamples: async (brandId: number): Promise<VoiceExample[]> => {
      await brands.ensureExists(brandId);
      return repo.listVoiceExamples(db, brandId);
    },
    addVoiceExample: async (brandId: number, input: VoiceExampleInput): Promise<VoiceExample> => {
      await brands.ensureExists(brandId);
      const id = await repo.insertVoiceExample(db, brandId, input);
      return (await repo.findVoiceExample(db, id))!;
    },
    removeVoiceExample: async (id: number): Promise<void> => {
      if (!(await repo.findVoiceExample(db, id))) throw new NotFoundError('Esempio di voce', id);
      await repo.deleteVoiceExample(db, id);
    },
    /** Testo della voce per i prompt dell'LLM. */
    voicePrompt: async (brandId: number): Promise<string> => {
      const [kit, examples] = await Promise.all([
        getKit(brandId),
        repo.listVoiceExamples(db, brandId, VOICE_PROMPT_EXAMPLES),
      ]);
      return formatVoice(kit.voiceRules, examples);
    },
  };
}

export type BrandKitService = ReturnType<typeof createBrandKitService>;
