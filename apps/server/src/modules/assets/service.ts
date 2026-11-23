import {
  InvalidTransitionError,
  PLATFORM_LABELS,
  VIDEO_VARIANT_FORMAT,
  canTransitionVariant,
  type RegisterExport,
  type RegisterVideo,
  type StorageStatus,
  type UploadTarget,
  type Variant,
  type VariantAsset,
} from '@prisma-app/shared';
import { renderInputKey } from '@prisma-app/templates';
import { createHash } from 'node:crypto';
import type { DbExecutor } from '../../db/executor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotConfiguredError,
  NotFoundError,
  VersionConflictError,
} from '../../http/error-handler.js';
import { objectKey, type ObjectStorage } from '../../storage/types.js';
import type { BrandKitService } from '../brand-kit/service.js';
import type { BrandService } from '../brands/service.js';
import { findContentRow } from '../contents/repository.js';
import {
  findVariantRow,
  insertRevision,
  toVariant,
  updateVariantIfVersion,
} from '../variants/repository.js';
import { applyVariantTransition } from '../variants/transitions.js';
import * as repo from './repository.js';

const KIND_BY_FORMAT = { jpg: 'image', pdf: 'pdf' } as const;
const MIME_BY_FORMAT = { jpg: 'image/jpeg', pdf: 'application/pdf' } as const;

/**
 * File esportati dal carosello. Non cambiano il contenuto (sono ricavati dalle slide salvate),
 * quindi non toccano lo stato della variant: si registrano solo se corrispondono allo stato
 * attuale di slide e brand kit, e risultano «non aggiornati» se questi cambiano dopo.
 */
export function createAssetService(
  db: DbExecutor,
  brands: BrandService,
  kits: BrandKitService,
  storage: ObjectStorage | null = null,
  now: () => Date = () => new Date(),
) {
  function requireStorage(): ObjectStorage {
    if (!storage) {
      throw new NotConfiguredError(
        'Storage R2 non configurato: imposta le variabili R2_* nel .env del server',
      );
    }
    return storage;
  }

  async function loadVariant(variantId: number) {
    const row = await findVariantRow(db, variantId);
    if (!row) throw new NotFoundError('Variant', variantId);
    const content = await findContentRow(db, row.contentId);
    if (!content) throw new NotFoundError('Contenuto', row.contentId);
    return { row, brandId: content.brandId };
  }

  /** sha256 dell'aspetto attuale delle slide; null se la variant non ha un carosello. */
  async function renderHashOf(variantId: number): Promise<string | null> {
    const { row, brandId } = await loadVariant(variantId);
    const carousel = row.metadata.carousel;
    if (!carousel) return null;
    const [brand, kit] = await Promise.all([brands.get(brandId), kits.getKit(brandId)]);
    return createHash('sha256')
      .update(renderInputKey(carousel, kit, brand.initials))
      .digest('hex');
  }

  async function list(variantId: number): Promise<VariantAsset[]> {
    const hash = await renderHashOf(variantId);
    const rows = await repo.listVariantAssets(db, variantId);
    return rows.map(({ renderHash, ...row }) => ({
      ...row,
      upToDate: renderHash === null || renderHash === hash,
    }));
  }

  async function registerExport(variantId: number, input: RegisterExport): Promise<VariantAsset[]> {
    const { row, brandId } = await loadVariant(variantId);
    const carousel = row.metadata.carousel;
    if (!carousel) throw new BusinessRuleError('La variant non ha un carosello da esportare');
    if (input.renderHash !== (await renderHashOf(variantId))) {
      throw new ConflictError(
        'Le slide o il brand kit sono cambiati durante l’esportazione: esporta di nuovo',
      );
    }
    const expected = input.format === 'pdf' ? 1 : carousel.slides.length;
    const positions = input.files.map((f) => f.position).sort((a, b) => a - b);
    if (positions.length !== expected || positions.some((p, i) => p !== i)) {
      throw new BusinessRuleError(
        input.format === 'pdf'
          ? 'L’export PDF è un solo file'
          : `Servono ${expected} immagini, una per slide`,
      );
    }
    if (input.files.some((f) => f.mime !== MIME_BY_FORMAT[input.format])) {
      throw new BusinessRuleError(`I file non sono ${input.format.toUpperCase()}`);
    }
    const kind = KIND_BY_FORMAT[input.format];

    await db.transaction(async (tx) => {
      await repo.removeMedia(tx, variantId, kind);
      for (const file of input.files) {
        const assetId = await repo.insertAsset(tx, {
          brandId,
          kind,
          localPath: file.localPath,
          mime: file.mime,
          sizeBytes: file.sizeBytes,
          width: file.width,
          height: file.height,
          checksumSha256: file.checksumSha256,
        });
        await repo.linkMedia(tx, {
          variantId,
          assetId,
          position: file.position,
          renderHash: input.renderHash,
        });
      }
    });
    return list(variantId);
  }

  async function findAsset(variantId: number, assetId: number) {
    const { brandId } = await loadVariant(variantId);
    const asset = await repo.findVariantAsset(db, variantId, assetId);
    if (!asset) throw new NotFoundError('File della variant', assetId);
    return { asset, brandId };
  }

  /**
   * Indirizzo firmato per caricare il file su R2. La chiave deriva dal contenuto (sha256): un
   * secondo caricamento dello stesso file è innocuo.
   */
  async function startUpload(variantId: number, assetId: number): Promise<UploadTarget> {
    const store = requireStorage();
    const { asset, brandId } = await findAsset(variantId, assetId);
    const key = objectKey(brandId, asset.checksumSha256, asset.mime);
    const upload = await store.presignPut(key, asset.mime);
    return {
      key,
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  /** Dopo il caricamento: il file deve esistere su R2 con la dimensione attesa. */
  async function completeUpload(variantId: number, assetId: number): Promise<VariantAsset[]> {
    const store = requireStorage();
    const { asset, brandId } = await findAsset(variantId, assetId);
    const key = objectKey(brandId, asset.checksumSha256, asset.mime);
    const stored = await store.head(key);
    if (!stored) throw new BusinessRuleError('File non trovato su R2: caricalo di nuovo');
    if (stored.sizeBytes !== asset.sizeBytes) {
      throw new BusinessRuleError(
        `Il file su R2 è di ${stored.sizeBytes} byte invece di ${asset.sizeBytes}: caricalo di nuovo`,
      );
    }
    await repo.setRemote(db, assetId, key, store.publicUrl(key));
    return list(variantId);
  }

  function storageStatus(): StorageStatus {
    return { configured: storage !== null, publicUrls: storage?.publicUrl('x') != null };
  }

  /**
   * Collega un video esportato dal desktop. A differenza dei caroselli il server non può
   * verificarlo (il progetto video vive sul computer) e cambia ciò che verrà pubblicato: la
   * variant passa dalla transizione `edit` (torna bozza, va riapprovata) e prende il formato
   * video della piattaforma. Il video precedente viene sostituito.
   */
  async function registerVideo(
    variantId: number,
    input: RegisterVideo,
  ): Promise<{ variant: Variant; assets: VariantAsset[] }> {
    const { row, brandId } = await loadVariant(variantId);
    if (!(row.platform in VIDEO_VARIANT_FORMAT)) {
      throw new BusinessRuleError(`${PLATFORM_LABELS[row.platform]} non pubblica video`);
    }
    if (row.version !== input.expectedVersion) throw new VersionConflictError('Variant', variantId);
    if (!canTransitionVariant(row.status, 'edit')) {
      throw new InvalidTransitionError('variant', row.status, 'edit');
    }
    const format = VIDEO_VARIANT_FORMAT[row.platform as keyof typeof VIDEO_VARIANT_FORMAT];
    const { file } = input;

    await db.transaction(async (tx) => {
      await applyVariantTransition(tx, variantId, 'edit', {
        expectedVersion: input.expectedVersion,
        now: now(),
      });
      const saved = await updateVariantIfVersion(tx, variantId, input.expectedVersion + 1, {
        format,
      });
      if (!saved) throw new VersionConflictError('Variant', variantId);
      await insertRevision(tx, {
        variantId,
        body: row.body,
        metadata: row.metadata,
        source: 'manuale',
        instruction: 'Video collegato',
      });
      await repo.removeMedia(tx, variantId, 'video');
      const assetId = await repo.insertAsset(tx, {
        brandId,
        kind: 'video',
        localPath: file.localPath,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        checksumSha256: file.checksumSha256,
      });
      await repo.linkMedia(tx, { variantId, assetId, position: 0, renderHash: null });
    });
    const updated = await findVariantRow(db, variantId);
    return { variant: toVariant(updated!), assets: await list(variantId) };
  }

  return { list, registerExport, registerVideo, startUpload, completeUpload, storageStatus };
}

export type AssetService = ReturnType<typeof createAssetService>;
