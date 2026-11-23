import { deriveAccountStatus, type SocialAccount } from '@prisma-app/shared';
import type { DbExecutor } from '../../db/executor.js';
import { NotFoundError } from '../../http/error-handler.js';
import type { BrandService } from '../brands/service.js';
import * as repo from './repository.js';

/**
 * Lo stato salvato dice com'era l'account all'ultimo collegamento; la scadenza del token
 * (60 giorni su LinkedIn, senza refresh) lo fa diventare `da_rinnovare` e poi `scollegato`.
 */
function withCurrentStatus(account: SocialAccount, now: Date): SocialAccount {
  if (account.status !== 'collegato') return account;
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
  return { ...account, status: deriveAccountStatus(expiresAt, now, false) };
}

/** Gli account si collegano via OAuth (`modules/oauth`); qui lettura con stato aggiornato. */
export function createSocialAccountService(
  db: DbExecutor,
  brands: BrandService,
  now: () => Date = () => new Date(),
) {
  return {
    list: async (brandId: number): Promise<SocialAccount[]> => {
      await brands.ensureExists(brandId);
      const accounts = await repo.listSocialAccounts(db, brandId);
      return accounts.map((account) => withCurrentStatus(account, now()));
    },
    get: async (id: number): Promise<SocialAccount> => {
      const account = await repo.findSocialAccount(db, id);
      if (!account) throw new NotFoundError('Account', id);
      return withCurrentStatus(account, now());
    },
  };
}

export type SocialAccountService = ReturnType<typeof createSocialAccountService>;
