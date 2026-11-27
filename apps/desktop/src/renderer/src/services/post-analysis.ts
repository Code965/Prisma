import {
  PLATFORM_LABELS,
  POST_DIMENSIONS,
  POST_DIMENSION_LABELS,
  POST_FORMAT_LABELS,
  type PlatformPostAnalysis,
  type PostAnalysis,
  type PostDimension,
} from '@prisma-app/shared';
import { percent } from './competitors';

/** «Cosa funziona nei tuoi post» (fase 8d): righe pronte per la schermata Analytics. */

const dateFormat = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: 'numeric',
  month: 'short',
});

export interface GroupRow {
  key: string;
  label: string;
  value: string;
  count: string;
  /** Larghezza della barra in percentuale del migliore della dimensione (0 senza valore). */
  width: number;
  fewData: boolean;
  publicationIds: number[];
}

export interface DimensionBlock {
  dimension: PostDimension;
  title: string;
  rows: GroupRow[];
}

/** «8 post misurati su 10 · tasso mediano 3,2% sulle visualizzazioni». */
export function platformSubtitle(p: PlatformPostAnalysis): string {
  const measured = `${p.measured} ${p.measured === 1 ? 'post misurato' : 'post misurati'} su ${p.published}`;
  if (p.measured === 0) return `${measured} · ancora nessuna metrica`;
  if (p.basis) {
    const basis = p.basis === 'visualizzazioni' ? 'sulle visualizzazioni' : 'sui follower';
    return `${measured} · tasso mediano ${percent(p.medianRate)} ${basis}`;
  }
  return `${measured} · interazioni mediane ${p.medianInteractions ?? '—'} (senza visualizzazioni né follower il tasso non si calcola)`;
}

const interactionsText = (n: number | null) =>
  n === null
    ? '—'
    : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(n)} interaz.`;

export function dimensionBlocks(p: PlatformPostAnalysis): DimensionBlock[] {
  return POST_DIMENSIONS.map((dimension) => {
    const groups = p.dimensions.find((d) => d.dimension === dimension)?.groups ?? [];
    const valueOf = (g: (typeof groups)[number]) =>
      (p.basis ? g.medianRate : g.medianInteractions) ?? 0;
    const best = Math.max(0, ...groups.map(valueOf));
    return {
      dimension,
      title: POST_DIMENSION_LABELS[dimension],
      rows: groups.map((g) => ({
        key: g.key,
        label: g.label,
        value: p.basis ? percent(g.medianRate) : interactionsText(g.medianInteractions),
        count: `${g.posts} post${g.fewData ? ' · pochi dati' : ''}`,
        width: best > 0 ? Math.round((valueOf(g) / best) * 100) : 0,
        fewData: g.fewData,
        publicationIds: g.publicationIds,
      })),
    };
  }).filter((b) => b.rows.length > 0);
}

export interface PostRow {
  id: number;
  title: string;
  url: string | null;
  meta: string;
  opening: string;
  value: string;
}

export function postRows(p: PlatformPostAnalysis, ids?: readonly number[]): PostRow[] {
  const posts = ids ? p.posts.filter((post) => ids.includes(post.publicationId)) : p.posts;
  return posts.map((post) => ({
    id: post.publicationId,
    title: post.title,
    url: post.url,
    meta: [
      dateFormat.format(new Date(post.publishedAt)),
      POST_FORMAT_LABELS[post.format],
      `${post.words} parole`,
      post.openingKind,
    ].join(' · '),
    opening: post.opening,
    value:
      post.interactions === null
        ? 'nessuna metrica'
        : post.rate !== null
          ? `${percent(post.rate)} · ${post.interactions} interaz.`
          : `${post.interactions} interaz.`,
  }));
}

export interface ConclusionRow {
  text: string;
  posts: Array<{ id: number; title: string; url: string | null; platform: string }>;
}

/** Conclusioni dell'AI con i post citati (titolo, link e piattaforma). */
export function conclusionRows(analysis: PostAnalysis | undefined): ConclusionRow[] {
  if (!analysis?.ai) return [];
  const byId = new Map(
    analysis.platforms.flatMap((p) =>
      p.posts.map((post) => [post.publicationId, { post, platform: p.platform }] as const),
    ),
  );
  return analysis.ai.conclusions.map((c) => ({
    text: c.text,
    posts: c.publicationIds.flatMap((id) => {
      const found = byId.get(id);
      return found
        ? [
            {
              id,
              title: found.post.title,
              url: found.post.url,
              platform: PLATFORM_LABELS[found.platform],
            },
          ]
        : [];
    }),
  }));
}

/** «DeepSeek · su 12 post · le aperture sono classificate dall'AI». */
export function aiSubtitle(analysis: PostAnalysis | undefined): string | null {
  if (!analysis?.ai) return null;
  return `${analysis.ai.model} · su ${analysis.ai.basedOn} post · aperture classificate dall'AI`;
}
