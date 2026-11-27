import type {
  EditorialPlan,
  Platform,
  PlanItemProgress,
  PlanItemReview,
  PlanPlatformReview,
  PlanReview,
  VariantStatus,
} from '@prisma-app/shared';
import { median } from '../competitors/stats.js';
import { monthDays } from './plan.js';

/** Un'uscita del mese (non annullata né in errore). */
export interface MonthPublication {
  id: number;
  /** Idea da cui nasce il contenuto, se c'è. */
  ideaId: number | null;
  platform: Platform;
  day: string;
  status: 'programmato' | 'in_pubblicazione' | 'pubblicato';
  url: string | null;
  interactions: number | null;
}

export interface ReviewFacts {
  /** Idee ancora esistenti. */
  ideas: ReadonlySet<number>;
  /** Variant dei contenuti nati da ogni idea. */
  variants: ReadonlyMap<number, ReadonlyArray<{ platform: Platform; status: VariantStatus }>>;
  publications: readonly MonthPublication[];
}

const DONE: readonly PlanItemProgress[] = ['programmato', 'pubblicato'];

/**
 * Revisione del piano (fase 8e): per ogni idea a che punto è (da creare, idea, in lavorazione,
 * programmata, pubblicata) e se il suo giorno è passato senza uscita; per piattaforma le uscite
 * previste, l'obiettivo della frequenza e quelle fatte nel mese, con la mediana delle interazioni
 * dove ci sono metriche. Funzione pura: i numeri sono conteggi e mediane, mai stime.
 */
export function reviewPlan(
  plan: Pick<EditorialPlan, 'month' | 'items' | 'frequencies'>,
  facts: ReviewFacts,
  today: string,
): PlanReview | null {
  const days = monthDays(plan.month);
  const first = days[0]!;
  const last = days.at(-1)!;
  if (today < first) return null;
  const until = today < last ? today : last;
  const elapsed = days.filter((d) => d <= until).length / days.length;

  const items: PlanItemReview[] = plan.items.map((item) => {
    const ideaId = item.ideaId !== null && facts.ideas.has(item.ideaId) ? item.ideaId : null;
    const publication =
      ideaId === null
        ? undefined
        : [...facts.publications]
            .filter((p) => p.ideaId === ideaId && p.platform === item.platform)
            .sort(
              (a, b) => Number(b.status === 'pubblicato') - Number(a.status === 'pubblicato'),
            )[0];
    const progress: PlanItemProgress =
      ideaId === null
        ? 'da_creare'
        : publication
          ? publication.status === 'pubblicato'
            ? 'pubblicato'
            : 'programmato'
          : (facts.variants.get(ideaId) ?? []).some((v) => v.platform === item.platform)
            ? 'bozza'
            : 'idea';
    return {
      itemId: item.id,
      progress,
      late: item.day < today && !DONE.includes(progress),
      publicationId: publication?.id ?? null,
      url: publication?.url ?? null,
      interactions: publication?.status === 'pubblicato' ? publication.interactions : null,
    };
  });

  const weeks = days.length / 7;
  const platforms = [
    ...new Set([...plan.frequencies.map((f) => f.platform), ...plan.items.map((i) => i.platform)]),
  ];
  const platformReviews: PlanPlatformReview[] = platforms.map((platform) => {
    const own = facts.publications.filter((p) => p.platform === platform);
    const published = own.filter((p) => p.status === 'pubblicato');
    const perWeek = plan.frequencies.find((f) => f.platform === platform)?.perWeek ?? 0;
    return {
      platform,
      planned: plan.items.filter((i) => i.platform === platform).length,
      target: Math.round(perWeek * weeks),
      published: published.length,
      scheduled: own.length - published.length,
      medianInteractions: median(
        published.flatMap((p) => (p.interactions !== null ? [p.interactions] : [])),
      ),
    };
  });

  const planIdeas = new Set(plan.items.flatMap((i) => (i.ideaId !== null ? [i.ideaId] : [])));
  const count = (progress: PlanItemProgress) => items.filter((i) => i.progress === progress).length;
  return {
    until,
    elapsed,
    totals: {
      items: items.length,
      ideas: items.length - count('da_creare'),
      drafts: count('bozza'),
      scheduled: count('programmato'),
      published: count('pubblicato'),
      late: items.filter((i) => i.late).length,
    },
    items,
    platforms: platformReviews,
    outsidePlan: facts.publications.filter((p) => p.ideaId === null || !planIdeas.has(p.ideaId))
      .length,
  };
}

/** Il riepilogo della revisione per il commento dell'AI: solo numeri calcolati qui. */
export function formatReview(review: PlanReview, labels: Record<Platform, string>): string {
  const t = review.totals;
  const lines = [
    `Mese trascorso: ${Math.round(review.elapsed * 100)}% (fino al ${review.until})`,
    `Idee del piano: ${t.items}; idee create: ${t.ideas}; in lavorazione: ${t.drafts}; programmate: ${t.scheduled}; pubblicate: ${t.published}; in ritardo: ${t.late}`,
    `Uscite del mese fuori dal piano: ${review.outsidePlan}`,
    ...review.platforms.map(
      (p) =>
        `${labels[p.platform]}: nel piano ${p.planned}, obiettivo ${p.target}, pubblicate ${p.published}, programmate ${p.scheduled}` +
        (p.medianInteractions !== null ? `, interazioni mediane ${p.medianInteractions}` : ''),
    ),
  ];
  return lines.join('\n');
}
