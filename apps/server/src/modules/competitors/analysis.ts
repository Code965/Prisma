import { PLATFORM_LABELS, type CompetitorAnalysis } from '@prisma-app/shared';
import { z } from 'zod';
import { interactions, type StatPost } from './stats.js';

/** Post mandati al modello al massimo, e per concorrente. */
export const MAX_ANALYSIS_POSTS = 40;
export const POSTS_PER_COMPETITOR = 8;
/** Servono almeno 3 post con numeri per un'analisi sensata. */
export const MIN_ANALYSIS_POSTS = 3;

export interface AnalysisPost extends StatPost {
  postId: number;
  competitor: string;
  platform: keyof typeof PLATFORM_LABELS;
  text: string | null;
  /** Tasso di interazione (con la base del profilo) o null. */
  rate: number | null;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Una riga per post, numerata: il modello cita i numeri dei post, mai le misure. */
export function formatAnalysisPosts(posts: readonly AnalysisPost[]): string {
  return posts
    .map((post, index) => {
      const body = (post.text ?? '').replace(/\s+/g, ' ').trim();
      const numbers = [
        post.views !== null ? `visualizzazioni ${post.views}` : null,
        post.likes !== null ? `like ${post.likes}` : null,
        post.comments !== null ? `commenti ${post.comments}` : null,
        post.shares !== null ? `condivisioni ${post.shares}` : null,
        post.rate !== null ? `tasso di interazione ${(post.rate * 100).toFixed(1)}%` : null,
      ]
        .filter(Boolean)
        .join(', ');
      const excerpt = body ? ` · testo (${words(body)} parole): "${body.slice(0, 600)}"` : '';
      return `[${index}] ${post.competitor} · ${PLATFORM_LABELS[post.platform]} · ${post.format} · titolo: "${post.title}"${excerpt} · ${numbers || 'nessun numero'}`;
    })
    .join('\n');
}

/** Risposta del modello: numeri dei post esistenti. Gli errori tornano al modello. */
export function competitorAnalysisSchema(postCount: number) {
  const refs = z
    .array(
      z
        .int()
        .min(0)
        .max(postCount - 1),
    )
    .min(1)
    .max(6);
  const text = (max: number) => z.string().trim().min(1).max(max);
  return z.object({
    summary: text(500),
    hooks: z
      .array(z.object({ pattern: text(200), posts: refs }))
      .min(1)
      .max(5),
    structure: text(500),
    length: text(300),
    topics: z
      .array(z.object({ topic: text(120), posts: refs }))
      .min(1)
      .max(5),
    repeat: z.array(text(200)).min(1).max(5),
    avoid: z.array(text(200)).max(3).default([]),
  });
}

export type GeneratedAnalysis = z.infer<ReturnType<typeof competitorAnalysisSchema>>;

/** Numeri dei post → id dei post salvati. */
export function toAnalysis(
  generated: GeneratedAnalysis,
  posts: readonly AnalysisPost[],
): Omit<CompetitorAnalysis, 'createdAt' | 'model'> {
  const ids = (refs: number[]) => [...new Set(refs)].map((i) => posts[i]!.postId);
  return {
    basedOn: posts.length,
    summary: generated.summary,
    hooks: generated.hooks.map((h) => ({ pattern: h.pattern, postIds: ids(h.posts) })),
    structure: generated.structure,
    length: generated.length,
    topics: generated.topics.map((t) => ({ topic: t.topic, postIds: ids(t.posts) })),
    repeat: generated.repeat,
    avoid: generated.avoid,
  };
}

/** I post migliori di ogni concorrente (per tasso, o interazioni), a turno fino al massimo. */
export function selectAnalysisPosts(
  groups: ReadonlyArray<readonly AnalysisPost[]>,
  max = MAX_ANALYSIS_POSTS,
): AnalysisPost[] {
  const queues = groups.map((posts) =>
    posts
      .filter((p) => interactions(p) !== null)
      .sort(
        (a, b) => (b.rate ?? 0) - (a.rate ?? 0) || (interactions(b) ?? 0) - (interactions(a) ?? 0),
      )
      .slice(0, POSTS_PER_COMPETITOR),
  );
  const result: AnalysisPost[] = [];
  for (let round = 0; result.length < max && queues.some((q) => q.length > round); round++) {
    for (const queue of queues) {
      if (result.length >= max) break;
      const post = queue[round];
      if (post) result.push(post);
    }
  }
  return result;
}
