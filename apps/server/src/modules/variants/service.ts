import {
  defaultFormat,
  formatForCarousel,
  isFormatSupported,
  type Variant,
  type VariantCreate,
  type VariantEdit,
  type VariantRevision,
  type Platform,
  type VariantStatus,
  type VariantTransition,
} from '@prisma-app/shared';
import { sanitizeArticleHtml } from '../../content/article-html.js';
import type { DbExecutor } from '../../db/executor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  VersionConflictError,
} from '../../http/error-handler.js';
import { findContentRow } from '../contents/repository.js';
import * as repo from './repository.js';
import { applyVariantTransition } from './transitions.js';

/** Gli articoli del blog sono HTML: si salvano solo i tag ammessi, anche se modificati a mano. */
function cleanBody(platform: Platform, body: string): string {
  return platform === 'blog' ? sanitizeArticleHtml(body) : body;
}

/** Si eliminano solo variant mai entrate in coda. */
const DELETABLE_STATUSES: readonly VariantStatus[] = ['bozza', 'da_approvare', 'approvato'];

export function createVariantService(db: DbExecutor, now: () => Date) {
  async function get(id: number): Promise<Variant> {
    const row = await repo.findVariantRow(db, id);
    if (!row) throw new NotFoundError('Variant', id);
    return repo.toVariant(row);
  }

  async function create(contentId: number, input: VariantCreate): Promise<Variant> {
    if (!(await findContentRow(db, contentId))) throw new NotFoundError('Contenuto', contentId);
    const format = input.format ?? defaultFormat(input.platform);
    if (!isFormatSupported(input.platform, format)) {
      throw new BusinessRuleError(`Il formato ${format} non è disponibile su ${input.platform}`);
    }
    const body = cleanBody(input.platform, input.body);
    const id = await db.transaction(async (tx) => {
      const variantId = await repo.insertVariant(tx, { contentId, ...input, body, format });
      if (body) {
        await repo.insertRevision(tx, { variantId, ...input, body, source: 'manuale' });
      }
      return variantId;
    });
    return get(id);
  }

  /** Ogni modifica passa per la transizione `edit`: una variant approvata torna bozza. */
  async function edit(id: number, input: VariantEdit): Promise<Variant> {
    await db.transaction(async (tx) => {
      const row = await repo.findVariantRow(tx, id, { forUpdate: true });
      if (!row) throw new NotFoundError('Variant', id);
      if (row.version !== input.expectedVersion) throw new VersionConflictError('Variant', id);

      await applyVariantTransition(tx, id, 'edit', { expectedVersion: row.version, now: now() });
      const body = cleanBody(row.platform, input.body);
      const saved = await repo.updateVariantIfVersion(tx, id, row.version + 1, {
        body,
        metadata: input.metadata,
        format: formatForCarousel(row.platform, row.format, row.metadata, input.metadata),
      });
      if (!saved) throw new VersionConflictError('Variant', id);
      await repo.insertRevision(tx, {
        variantId: id,
        body,
        metadata: input.metadata,
        source: 'manuale',
      });
    });
    return get(id);
  }

  async function transition(id: number, input: VariantTransition): Promise<Variant> {
    return db.transaction((tx) =>
      applyVariantTransition(tx, id, input.action, {
        expectedVersion: input.expectedVersion,
        now: now(),
      }),
    );
  }

  async function remove(id: number): Promise<void> {
    const variant = await get(id);
    if (!DELETABLE_STATUSES.includes(variant.status)) {
      throw new BusinessRuleError(`Una variant in stato ${variant.status} non si può eliminare`);
    }
    if ((await repo.countPublicationsOfVariants(db, [id])) > 0) {
      throw new ConflictError('La variant ha uno storico di pubblicazioni e non si può eliminare');
    }
    await repo.deleteVariant(db, id);
  }

  async function revisions(id: number): Promise<VariantRevision[]> {
    await get(id);
    return repo.listRevisions(db, id);
  }

  /** Riporta il testo a una revisione precedente: è una modifica come le altre (torna bozza). */
  async function restore(
    id: number,
    revisionId: number,
    expectedVersion: number,
  ): Promise<Variant> {
    const revision = await repo.findRevision(db, id, revisionId);
    if (!revision) throw new NotFoundError('Revisione', revisionId);
    return edit(id, { body: revision.body, metadata: revision.metadata, expectedVersion });
  }

  return { get, create, edit, transition, remove, revisions, restore };
}

export type VariantService = ReturnType<typeof createVariantService>;
