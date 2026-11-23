import { z } from 'zod';

const positiveId = z.coerce.number().int().positive();

export const IdParamsSchema = z.object({ id: positiveId });
export const BrandParamsSchema = z.object({ brandId: positiveId });
export const ContentParamsSchema = z.object({ contentId: positiveId });

export function parseId(params: unknown): number {
  return IdParamsSchema.parse(params).id;
}

export function parseBrandId(params: unknown): number {
  return BrandParamsSchema.parse(params).brandId;
}
