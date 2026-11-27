import {
  TREND_SOURCE_LABELS,
  type Tag,
  type Trend,
  type TrendItem,
  type TrendSignals,
} from '@prisma-app/shared';
import { z } from 'zod';

/** Contenuti mandati al modello al massimo (i più popolari dentro ogni fonte e parola). */
export const MAX_PROMPT_ITEMS = 80;

const SIGNAL_LABELS: Record<keyof TrendSignals, string> = {
  points: 'punti',
  comments: 'commenti',
  stars: 'stelle',
  reactions: 'reazioni',
  views: 'visualizzazioni',
  likes: 'like',
};

export function formatSignals(signals: TrendSignals): string {
  const parts = (Object.keys(SIGNAL_LABELS) as Array<keyof TrendSignals>)
    .filter((key) => signals[key] !== undefined)
    .map((key) => `${SIGNAL_LABELS[key]} ${signals[key]}`);
  return parts.join(', ') || 'nessun segnale';
}

/** Una riga per contenuto, numerata: il modello risponde con i numeri. */
export function formatItems(items: readonly TrendItem[]): string {
  return items
    .map((item, index) => {
      const description = item.description ? ` — ${item.description}` : '';
      return `[${index}] ${TREND_SOURCE_LABELS[item.source]} · ${item.keyword} · "${item.title}"${description} · ${formatSignals(item.signals)}`;
    })
    .join('\n');
}

/**
 * Risposta del modello, costruita sulla richiesta: numeri dei contenuti esistenti e usati una
 * volta sola, argomento preso dall'elenco del brand. Gli errori tornano al modello che ritenta.
 */
export function generatedTrendsSchema(itemCount: number, tags: readonly Tag[]) {
  const tagNames = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.id]));
  const score = z.coerce.number().int().min(1).max(5);
  return z
    .object({
      trends: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(80),
            summary: z.string().trim().min(1).max(400),
            why: z.string().trim().min(1).max(300),
            growth: score,
            interest: score,
            fit: score,
            tag: z.string().trim().nullish(),
            idea: z.string().trim().min(1).max(500),
            items: z
              .array(
                z
                  .int()
                  .min(0)
                  .max(itemCount - 1),
              )
              .min(1),
          }),
        )
        .min(1)
        .max(8),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<number>();
      value.trends.forEach((trend, index) => {
        for (const item of new Set(trend.items)) {
          if (seen.has(item)) {
            ctx.addIssue({
              code: 'custom',
              path: ['trends', index, 'items'],
              message: `Il contenuto ${item} è già in un altro trend`,
            });
          }
          seen.add(item);
        }
        if (trend.tag && !tagNames.has(trend.tag.toLowerCase())) {
          ctx.addIssue({
            code: 'custom',
            path: ['trends', index, 'tag'],
            message: `"${trend.tag}" non è tra gli argomenti del brand: usa uno dell'elenco o null`,
          });
        }
      });
    })
    .transform((value) =>
      value.trends.map((trend) => ({
        ...trend,
        tagId: trend.tag ? (tagNames.get(trend.tag.toLowerCase()) ?? null) : null,
      })),
    );
}

export type GeneratedTrend = z.infer<ReturnType<typeof generatedTrendsSchema>>[number];

/** Trend da salvare: id dei contenuti al posto dei numeri, dal più promettente. */
export function toTrends(
  generated: readonly GeneratedTrend[],
  items: readonly TrendItem[],
): Trend[] {
  return generated
    .map((trend) => ({
      title: trend.title,
      summary: trend.summary,
      why: trend.why,
      scores: { growth: trend.growth, interest: trend.interest, fit: trend.fit },
      tagId: trend.tagId,
      idea: trend.idea,
      itemIds: [...new Set(trend.items)].map((index) => items[index]!.id),
    }))
    .sort(
      (a, b) =>
        b.scores.fit +
        b.scores.interest +
        b.scores.growth -
        (a.scores.fit + a.scores.interest + a.scores.growth),
    );
}

/**
 * Contenuti per il prompt: senza doppioni (lo stesso link trovato con due parole), e se sono
 * troppi tiene a turno i migliori di ogni fonte (sono già in ordine di popolarità).
 */
export function selectItems(items: readonly TrendItem[], max = MAX_PROMPT_ITEMS): TrendItem[] {
  const unique = new Map<string, TrendItem>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  const groups = new Map<string, TrendItem[]>();
  for (const item of unique.values()) {
    const key = `${item.source}:${item.keyword}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const queues = [...groups.values()];
  const result: TrendItem[] = [];
  for (let round = 0; result.length < max && queues.some((q) => q.length > round); round++) {
    for (const queue of queues) {
      if (result.length >= max) break;
      const item = queue[round];
      if (item) result.push(item);
    }
  }
  return result;
}
