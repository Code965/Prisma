import type { Brand } from '@prisma-app/shared';

/** Brand attivo: quello scelto se esiste ancora, altrimenti il primo dell'elenco. */
export function pickBrand(brands: readonly Brand[], selectedId: number | null): Brand | null {
  return brands.find((brand) => brand.id === selectedId) ?? brands[0] ?? null;
}
