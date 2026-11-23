import type { Platform, SocialAccount } from '@prisma-app/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { toIso, toIsoOrNull, type DbExecutor } from '../../db/executor.js';
import { socialAccounts } from '../../db/schema.js';

/** Colonne pubbliche: i token cifrati non vengono mai letti qui. */
const publicColumns = {
  id: socialAccounts.id,
  brandId: socialAccounts.brandId,
  platform: socialAccounts.platform,
  handle: socialAccounts.handle,
  displayName: socialAccounts.displayName,
  status: socialAccounts.status,
  tokenExpiresAt: socialAccounts.tokenExpiresAt,
  refreshTokenExpiresAt: socialAccounts.refreshTokenExpiresAt,
  hasRefreshToken: sql<number>`${socialAccounts.refreshTokenEnc} IS NOT NULL`,
  lastError: socialAccounts.lastError,
  createdAt: socialAccounts.createdAt,
  updatedAt: socialAccounts.updatedAt,
};

type PublicRow = {
  [
    K in Exclude<keyof typeof publicColumns, 'hasRefreshToken'>
  ]: (typeof socialAccounts.$inferSelect)[K];
} & { hasRefreshToken: number | string | boolean };

/**
 * Con un refresh token (YouTube, TikTok) il token di accesso dura ore e si rinnova da solo:
 * la scadenza che conta per l'account è quella del refresh token (nessuna per YouTube).
 */
function toSocialAccount(row: PublicRow): SocialAccount {
  const { hasRefreshToken, refreshTokenExpiresAt, ...rest } = row;
  const expiresAt = Number(hasRefreshToken) ? refreshTokenExpiresAt : row.tokenExpiresAt;
  return {
    ...rest,
    tokenExpiresAt: toIsoOrNull(expiresAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listSocialAccounts(
  db: DbExecutor,
  brandId: number,
): Promise<SocialAccount[]> {
  const rows = await db
    .select(publicColumns)
    .from(socialAccounts)
    .where(eq(socialAccounts.brandId, brandId))
    .orderBy(asc(socialAccounts.platform));
  return rows.map(toSocialAccount);
}

export async function findSocialAccount(db: DbExecutor, id: number): Promise<SocialAccount | null> {
  const [row] = await db
    .select(publicColumns)
    .from(socialAccounts)
    .where(eq(socialAccounts.id, id));
  return row ? toSocialAccount(row) : null;
}

/**
 * Collega o ricollega un account: se esiste già (stesso brand, piattaforma e id esterno)
 * aggiorna token e scadenza, così ricollegare non crea doppioni e non perde lo storico.
 */
export async function upsertSocialAccount(
  db: DbExecutor,
  values: {
    brandId: number;
    platform: Platform;
    externalId: string;
    displayName: string;
    handle: string | null;
    accessTokenEnc: Buffer;
    refreshTokenEnc: Buffer | null;
    tokenExpiresAt: Date | null;
    refreshTokenExpiresAt: Date | null;
    scopes: string;
  },
): Promise<number> {
  const { brandId, platform, externalId, ...updatable } = values;
  await db
    .insert(socialAccounts)
    .values({ ...values, status: 'collegato' })
    .onConflictDoUpdate({
      target: [socialAccounts.brandId, socialAccounts.platform, socialAccounts.externalId],
      set: { ...updatable, status: 'collegato', lastError: null, updatedAt: new Date() },
    });
  const [row] = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.brandId, brandId),
        eq(socialAccounts.platform, platform),
        eq(socialAccounts.externalId, externalId),
      ),
    );
  if (!row) throw new Error('Salvataggio account fallito');
  return row.id;
}

/** Token rinnovati (già cifrati): accesso con la sua scadenza e, se ruotato, il refresh token. */
export async function updateAccountTokens(
  db: DbExecutor,
  id: number,
  values: {
    accessTokenEnc: Buffer;
    tokenExpiresAt: Date;
    refreshTokenEnc?: Buffer;
    refreshTokenExpiresAt?: Date | null;
  },
): Promise<void> {
  await db.update(socialAccounts).set(values).where(eq(socialAccounts.id, id));
}
