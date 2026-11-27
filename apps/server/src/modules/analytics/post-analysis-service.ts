import {
  PLATFORM_LABELS,
  POST_ANALYSIS_MIN_POSTS,
  POST_ANALYSIS_WINDOW_DAYS,
  POST_DIMENSION_LABELS,
  POST_FORMAT_LABELS,
  type AnalyzedPost,
  type Platform,
  type PlatformPostAnalysis,
  type PostAnalysis,
} from '@prisma-app/shared';
import { z } from 'zod';
import type { DbExecutor } from '../../db/executor.js';
import { BusinessRuleError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { addDays, romeDay } from './aggregate.js';
import { analyzePosts, type OwnPost } from './post-analysis.js';
import * as repo from './repository.js';
import { romeSlot } from './slots.js';

const DAY = 86_400_000;
/** Post mandati al modello al massimo. */
export const MAX_AI_POSTS = 60;
const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

/** Post misurati per il modello: per piattaforma, dal migliore, al massimo 60. */
export function selectAiPosts(platforms: readonly PlatformPostAnalysis[]): AnalyzedPost[] {
  return platforms
    .flatMap((p) =>
      p.posts
        .filter((post) => post.interactions !== null)
        .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.interactions! - a.interactions!),
    )
    .slice(0, MAX_AI_POSTS);
}

/** Una riga per post, numerata: il modello cita i numeri dei post. */
export function formatAiPosts(
  posts: readonly AnalyzedPost[],
  platformOf: ReadonlyMap<number, PlatformPostAnalysis>,
): string {
  return posts
    .map((post, index) => {
      const platform = platformOf.get(post.publicationId)!;
      const slot = romeSlot(new Date(post.publishedAt));
      const numbers = [
        `interazioni ${post.interactions}`,
        post.rate !== null ? `tasso ${percent(post.rate)} (su ${platform.basis})` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `[${index}] ${PLATFORM_LABELS[platform.platform]} · ${POST_FORMAT_LABELS[post.format]} · ${WEEKDAYS[slot.weekday]} ${String(slot.hour).padStart(2, '0')}:00 · argomenti: ${post.tags.join(', ') || 'nessuno'} · ${post.words} parole · apertura: "${post.opening}" · ${numbers}`;
    })
    .join('\n');
}

/** Gruppi già calcolati, senza l'apertura (la classifica il modello). */
export function formatGroups(platforms: readonly PlatformPostAnalysis[]): string {
  const lines: string[] = [];
  for (const p of platforms) {
    const base = p.basis ? `tasso su ${p.basis}` : 'interazioni (nessun tasso)';
    lines.push(`${PLATFORM_LABELS[p.platform]} · ${p.measured} post misurati · ${base}`);
    for (const { dimension, groups } of p.dimensions) {
      if (dimension === 'apertura' || groups.length === 0) continue;
      const list = groups
        .map((g) => {
          const value =
            g.medianRate !== null
              ? `tasso mediano ${percent(g.medianRate)}`
              : `interazioni mediane ${g.medianInteractions}`;
          return `${g.label}: ${g.posts} post, ${value}${g.fewData ? ', pochi dati' : ''}`;
        })
        .join('; ');
      lines.push(`- ${POST_DIMENSION_LABELS[dimension]}: ${list}`);
    }
  }
  return lines.join('\n');
}

/** Risposta del modello: ogni post in un solo tipo di apertura, numeri di post esistenti. */
export function postAnalysisSchema(postCount: number) {
  const index = z
    .int()
    .min(0)
    .max(postCount - 1);
  return z
    .object({
      openings: z
        .array(z.object({ label: z.string().trim().min(1).max(40), posts: z.array(index).min(1) }))
        .min(1)
        .max(6),
      conclusions: z
        .array(
          z.object({
            text: z.string().trim().min(1).max(300),
            posts: z.array(index).max(6).default([]),
          }),
        )
        .min(3)
        .max(5),
    })
    .superRefine((value, ctx) => {
      const seen = value.openings.flatMap((o) => o.posts);
      for (let i = 0; i < postCount; i++) {
        const times = seen.filter((n) => n === i).length;
        if (times !== 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['openings'],
            message: `Il post ${i} deve stare in esattamente un tipo di apertura (ora ${times})`,
          });
        }
      }
    });
}

interface PostAnalysisDeps {
  db: DbExecutor;
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  now: () => Date;
}

/**
 * Analisi dei propri post (fase 8d): gruppi calcolati sempre; con «Analizza con l'AI» il modello
 * classifica le aperture e scrive le conclusioni. Il risultato dell'AI non si salva.
 */
export function createPostAnalysisService(deps: PostAnalysisDeps) {
  const { db, brands, now, prompts } = deps;

  async function load(brandId: number) {
    const at = now();
    const rows = await repo.publishedPostsForBrand(
      db,
      brandId,
      new Date(at.getTime() - POST_ANALYSIS_WINDOW_DAYS * DAY),
    );
    const details = await repo.postDetails(
      db,
      rows.map((r) => r.publicationId),
    );
    const posts: OwnPost[] = rows.map((r) => {
      const d = details.get(r.publicationId);
      return {
        publicationId: r.publicationId,
        platform: r.platform,
        title: r.title,
        url: r.externalUrl,
        publishedAt: r.publishedAt,
        format: r.format,
        body: d?.body ?? '',
        heading: d?.heading ?? null,
        tags: d?.tags ?? [],
        metrics: r.metrics,
      };
    });
    // Follower dell'ultimo giorno rilevato (per il tasso quando mancano le visualizzazioni).
    const today = romeDay(at);
    const days = await repo.accountDaysForBrand(db, brandId, addDays(today, -14), today);
    const followers: Partial<Record<Platform, number | null>> = {};
    for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
      if (d.followers !== null) followers[d.platform] = d.followers;
    }
    return { at, posts, followers };
  }

  function blockedReason(measured: number, configured: boolean): string | null {
    if (!configured) return 'AI non configurata: scegli il servizio in Impostazioni › AI';
    if (measured < POST_ANALYSIS_MIN_POSTS) {
      return `Servono almeno ${POST_ANALYSIS_MIN_POSTS} post con metriche negli ultimi 90 giorni (ora ${measured})`;
    }
    return null;
  }

  const measuredOf = (platforms: readonly PlatformPostAnalysis[]) =>
    platforms.reduce((sum, p) => sum + p.measured, 0);

  return {
    async report(brandId: number): Promise<PostAnalysis> {
      await brands.ensureExists(brandId);
      const { at, posts, followers } = await load(brandId);
      const platforms = analyzePosts(posts, followers, at);
      return {
        generatedAt: at.toISOString(),
        windowDays: POST_ANALYSIS_WINDOW_DAYS,
        platforms,
        aiBlocked: blockedReason(measuredOf(platforms), (await deps.llm.current()) !== null),
        ai: null,
      };
    },

    async analyze(brandId: number): Promise<PostAnalysis> {
      const brand = await brands.get(brandId);
      const { at, posts, followers } = await load(brandId);
      const base = analyzePosts(posts, followers, at);
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const blocked = blockedReason(measuredOf(base), true);
      if (blocked) throw new BusinessRuleError(blocked);

      const selected = selectAiPosts(base);
      const platformOf = new Map(
        base.flatMap((p) => p.posts.map((post) => [post.publicationId, p] as const)),
      );
      const generated = await llm.completeJson({
        schema: postAnalysisSchema(selected.length),
        messages: [
          {
            role: 'system',
            content: prompts.render('analyze-posts.system', { brandName: brand.name }),
          },
          {
            role: 'user',
            content: prompts.render('analyze-posts.user', {
              posts: formatAiPosts(selected, platformOf),
              groups: formatGroups(base),
            }),
          },
        ],
      });
      const ids = (refs: number[]) => [...new Set(refs)].map((i) => selected[i]!.publicationId);
      const openings = new Map<number, string>();
      for (const o of generated.openings) {
        for (const id of ids(o.posts)) openings.set(id, o.label);
      }
      const platforms = analyzePosts(posts, followers, at, openings);
      return {
        generatedAt: at.toISOString(),
        windowDays: POST_ANALYSIS_WINDOW_DAYS,
        platforms,
        aiBlocked: null,
        ai: {
          model: llm.name,
          createdAt: now().toISOString(),
          basedOn: selected.length,
          conclusions: generated.conclusions.map((c) => ({
            text: c.text,
            publicationIds: ids(c.posts),
          })),
        },
      };
    },
  };
}

export type PostAnalysisService = ReturnType<typeof createPostAnalysisService>;
