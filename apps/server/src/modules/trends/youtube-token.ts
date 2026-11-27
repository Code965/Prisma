import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/executor.js';
import { socialAccounts } from '../../db/schema.js';
import type { AccessTokenResolver } from '../social-accounts/tokens.js';

/**
 * Token dell'account YouTube collegato al brand per le ricerche del radar (lo scope `youtube`
 * copre `search.list`). Nessun account, nessun resolver o rinnovo fallito → null.
 */
export function youtubeTokenFor(db: DbExecutor, resolver: AccessTokenResolver | null) {
  return async (brandId: number): Promise<string | null> => {
    if (!resolver) return null;
    const [account] = await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.brandId, brandId),
          eq(socialAccounts.platform, 'youtube'),
          inArray(socialAccounts.status, ['collegato', 'da_rinnovare']),
        ),
      )
      .limit(1);
    if (!account) return null;
    try {
      return await resolver(account);
    } catch {
      return null;
    }
  };
}
