import {
  PLATFORM_LABELS,
  deriveAccountStatus,
  type PublicationChecks,
  type QueueCheck,
} from '@prisma-app/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/executor.js';
import { contents, publications, socialAccounts, variants } from '../../db/schema.js';
import { NO_MEDIA, type MediaLoader, type PublisherRegistry } from '../../publishers/types.js';
import { toVariant } from '../variants/repository.js';

/**
 * Controlli dei requisiti per i post in coda (V3Coda): gli stessi `validate()` che lo scheduler
 * usa prima di pubblicare, più account e scadenza del token. Così la coda mostra in anticipo
 * ciò che bloccherebbe l'uscita.
 */
export async function queueChecks(
  db: DbExecutor,
  brandId: number,
  publishers: PublisherRegistry,
  now: Date,
  loadMedia: MediaLoader = NO_MEDIA,
): Promise<PublicationChecks[]> {
  const rows = await db
    .select({ publication: publications, variant: variants, account: socialAccounts })
    .from(publications)
    .innerJoin(variants, eq(variants.id, publications.variantId))
    .innerJoin(contents, eq(contents.id, variants.contentId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publications.socialAccountId))
    .where(
      and(
        eq(contents.brandId, brandId),
        inArray(publications.status, ['programmato', 'in_pubblicazione']),
      ),
    );

  return Promise.all(
    rows.map(async ({ publication, variant, account }) => {
      const checks: QueueCheck[] = [];
      const label = PLATFORM_LABELS[variant.platform];
      const adapter = publishers.get(variant.platform);

      if (!adapter) {
        checks.push({
          level: 'warning',
          message: `Pubblicazione automatica su ${label} non ancora disponibile: il post resta in coda`,
        });
      } else {
        checks.push(...adapter.validate(toVariant(variant), await loadMedia(variant.id)));
      }

      const status =
        account.status === 'collegato'
          ? deriveAccountStatus(account.tokenExpiresAt, now, false)
          : account.status;
      if (status === 'scollegato' || status === 'errore') {
        checks.push({
          level: 'error',
          message: `Account ${label} ${status}: ricollegalo nelle Impostazioni`,
        });
      } else if (account.tokenExpiresAt && account.tokenExpiresAt < publication.scheduledAt) {
        checks.push({
          level: 'error',
          message: `Il token ${label} scade prima dell'uscita: ricollega l'account`,
        });
      } else if (status === 'da_rinnovare') {
        checks.push({ level: 'warning', message: `Token ${label} da rinnovare a breve` });
      } else {
        checks.push({ level: 'ok', message: `Account ${account.displayName}` });
      }

      return { publicationId: publication.id, checks };
    }),
  );
}
