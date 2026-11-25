import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/executor.js';
import { assets, variantAssets } from '../../db/schema.js';

export type AssetKind = (typeof assets.$inferSelect)['kind'];

export interface VariantAssetRow {
  assetId: number;
  kind: AssetKind;
  role: 'media' | 'copertina';
  position: number;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksumSha256: string;
  localPath: string | null;
  remoteKey: string | null;
  remoteUrl: string | null;
  renderHash: string | null;
}

export async function listVariantAssets(
  db: DbExecutor,
  variantId: number,
): Promise<VariantAssetRow[]> {
  return db
    .select({
      assetId: assets.id,
      kind: assets.kind,
      role: variantAssets.role,
      position: variantAssets.position,
      mime: assets.mime,
      sizeBytes: assets.sizeBytes,
      width: assets.width,
      height: assets.height,
      durationMs: assets.durationMs,
      checksumSha256: assets.checksumSha256,
      localPath: assets.localPath,
      remoteKey: assets.remoteKey,
      remoteUrl: assets.remoteUrl,
      renderHash: variantAssets.renderHash,
    })
    .from(variantAssets)
    .innerJoin(assets, eq(assets.id, variantAssets.assetId))
    .where(eq(variantAssets.variantId, variantId))
    .orderBy(asc(assets.kind), asc(variantAssets.position));
}

/** Toglie dalla variant i media di un tipo (export precedente) ed elimina gli asset rimasti orfani. */
export async function removeMedia(
  db: DbExecutor,
  variantId: number,
  kind: AssetKind,
): Promise<void> {
  const linked = await db
    .select({ assetId: variantAssets.assetId })
    .from(variantAssets)
    .innerJoin(assets, eq(assets.id, variantAssets.assetId))
    .where(
      and(
        eq(variantAssets.variantId, variantId),
        eq(variantAssets.role, 'media'),
        eq(assets.kind, kind),
      ),
    );
  const ids = linked.map((row) => row.assetId);
  if (ids.length === 0) return;
  await db
    .delete(variantAssets)
    .where(and(eq(variantAssets.variantId, variantId), inArray(variantAssets.assetId, ids)));
  const stillUsed = await db
    .select({ assetId: variantAssets.assetId })
    .from(variantAssets)
    .where(inArray(variantAssets.assetId, ids));
  const orphans = ids.filter((id) => !stillUsed.some((row) => row.assetId === id));
  if (orphans.length > 0) await db.delete(assets).where(inArray(assets.id, orphans));
}

export async function insertAsset(
  db: DbExecutor,
  values: typeof assets.$inferInsert,
): Promise<number> {
  const [created] = await db.insert(assets).values(values).returning({ id: assets.id });
  if (!created) throw new Error('Inserimento asset fallito');
  return created.id;
}

export async function linkMedia(
  db: DbExecutor,
  values: { variantId: number; assetId: number; position: number; renderHash: string | null },
): Promise<void> {
  await db.insert(variantAssets).values({ ...values, role: 'media' });
}

export async function findVariantAsset(
  db: DbExecutor,
  variantId: number,
  assetId: number,
): Promise<VariantAssetRow | null> {
  const rows = await listVariantAssets(db, variantId);
  return rows.find((row) => row.assetId === assetId) ?? null;
}

export async function setRemote(
  db: DbExecutor,
  assetId: number,
  remoteKey: string,
  remoteUrl: string | null,
): Promise<void> {
  await db.update(assets).set({ remoteKey, remoteUrl }).where(eq(assets.id, assetId));
}

/** Chiavi R2 dei file esportati ancora registrati (quelli superati sono già stati tolti). */
export async function listRemoteKeys(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ key: assets.remoteKey })
    .from(assets)
    .where(isNotNull(assets.remoteKey));
  return rows.flatMap((row) => (row.key ? [row.key] : []));
}
