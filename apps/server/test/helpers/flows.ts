import type { Content, Platform, PublicationView, Variant } from '@prisma-app/shared';
import type { TestContext } from './integration.js';

export const LATER = '2026-11-22T17:00:00.000Z';

/** Crea brand, account e una variant approvata, poi la programma: lo scenario base della coda. */
export async function scheduledPublication(
  ctx: TestContext,
  options: { platform?: Platform; scheduledAt?: string } = {},
): Promise<{ publication: PublicationView; brandId: number }> {
  const platform = options.platform ?? 'linkedin';
  const brandId = await ctx.createBrand();
  const accountId = await ctx.createAccount(brandId, platform);

  const content = (
    await ctx.call({
      method: 'POST',
      url: `/brands/${brandId}/contents`,
      payload: { title: 'Post di prova', platforms: [platform] },
    })
  ).json<Content>();
  let variant = content.variants[0]!;
  variant = (
    await ctx.call({
      method: 'PATCH',
      url: `/variants/${variant.id}`,
      payload: {
        body: 'Testo approvato',
        metadata: { hashtags: [] },
        expectedVersion: variant.version,
      },
    })
  ).json<Variant>();
  for (const action of ['submit', 'approve']) {
    variant = (
      await ctx.call({
        method: 'POST',
        url: `/variants/${variant.id}/transitions`,
        payload: { action, expectedVersion: variant.version },
      })
    ).json<Variant>();
  }

  const res = await ctx.call({
    method: 'POST',
    url: '/publications',
    payload: {
      variantId: variant.id,
      socialAccountId: accountId,
      scheduledAt: options.scheduledAt ?? LATER,
    },
  });
  if (res.statusCode !== 201) throw new Error(`Programmazione fallita: ${res.body}`);
  return { publication: res.json<PublicationView>(), brandId };
}
