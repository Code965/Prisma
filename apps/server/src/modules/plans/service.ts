import {
  PLAN_MONTHS_AHEAD,
  PLATFORM_LABELS,
  POST_FORMAT_LABELS,
  PlanGenerateInputSchema,
  PlanIdeasInputSchema,
  PlanMonthSchema,
  SOCIAL_PLATFORMS,
  slotMap,
  type CompetitorsState,
  type EditorialPlan,
  type Platform,
  type PlanReference,
  type PlanState,
  type PostAnalysis,
  type TrendsState,
} from '@prisma-app/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../db/executor.js';
import { editorialPlans } from '../../db/schema.js';
import { BusinessRuleError, NotFoundError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import { inventedNumbers, numbersIn } from '../ai/inspire.js';
import { romeDay } from '../analytics/aggregate.js';
import type { AnalyticsService } from '../analytics/service.js';
import type { PostAnalysisService } from '../analytics/post-analysis-service.js';
import { formatGroups } from '../analytics/post-analysis-service.js';
import type { BrandService } from '../brands/service.js';
import type { CompetitorsService } from '../competitors/service.js';
import * as ideasRepo from '../ideas/repository.js';
import type { SocialAccountService } from '../social-accounts/service.js';
import type { TagService } from '../tags/service.js';
import type { TrendsService } from '../trends/service.js';
import {
  addMonths,
  bookedKey,
  formatDays,
  formatRefs,
  formatSlots,
  generatedPlanSchema,
  planIdeaText,
  plannableDays,
  toPlan,
  type PlanRefs,
  type PlanRequest,
} from './plan.js';
import * as repo from './repository.js';
import { formatReview, reviewPlan } from './review.js';

/** Riferimenti mandati al modello al massimo, per tipo. */
const MAX_REFS = 12;

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;
const short = (text: string, max = 120) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

interface PlanDeps {
  db: DbExecutor;
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  tags: TagService;
  accounts: SocialAccountService;
  analytics: AnalyticsService;
  postAnalysis: PostAnalysisService;
  trends: TrendsService;
  competitors: CompetitorsService;
  voice: (brandId: number) => Promise<string>;
  now: () => Date;
}

/** Trend del radar: titolo, idea e argomento; il link al primo contenuto. */
export function trendRefs(state: TrendsState): { refs: PlanReference[]; lines: string[] } {
  const report = state.report;
  if (!report) return { refs: [], lines: [] };
  const trends = report.trends.slice(0, MAX_REFS);
  return {
    refs: trends.map((t) => ({
      label: t.title,
      url: report.items.find((i) => i.id === t.itemIds[0])?.url ?? null,
    })),
    lines: trends.map(
      (t) =>
        `${t.title} — ${t.summary} — idea: ${t.idea} — crescita ${t.scores.growth}/5, adatto al brand ${t.scores.fit}/5`,
    ),
  };
}

/** Post dei concorrenti citati dall'analisi dell'AI o, senza analisi, i migliori per profilo. */
export function competitorRefs(state: CompetitorsState): {
  refs: PlanReference[];
  lines: string[];
} {
  const cited = new Set(
    [...(state.analysis?.hooks ?? []), ...(state.analysis?.topics ?? [])].flatMap((x) => x.postIds),
  );
  const posts = state.competitors.flatMap((c) =>
    c.stats.top
      .filter((p) => cited.size === 0 || (p.postId !== null && cited.has(p.postId)))
      .map((p) => ({ competitor: c, post: p })),
  );
  const chosen = posts
    .sort(
      (a, b) =>
        (b.post.rate ?? 0) - (a.post.rate ?? 0) || b.post.interactions - a.post.interactions,
    )
    .slice(0, MAX_REFS);
  return {
    refs: chosen.map(({ competitor, post }) => ({
      label: `${competitor.name}: ${short(post.title, 80)}`,
      url: post.url,
    })),
    lines: chosen.map(
      ({ competitor, post }) =>
        `${competitor.name} · ${PLATFORM_LABELS[competitor.platform]} · ${POST_FORMAT_LABELS[post.format]} · "${short(post.title)}" · interazioni ${post.interactions}` +
        (post.rate !== null && competitor.stats.medianRate !== null
          ? ` · tasso ${percent(post.rate)} (mediana del profilo ${percent(competitor.stats.medianRate)})`
          : ''),
    ),
  };
}

export function competitorSummary(state: CompetitorsState): string {
  const a = state.analysis;
  if (!a) return 'Nessuna analisi dei concorrenti.';
  return [
    a.summary,
    `Aperture che funzionano: ${a.hooks.map((h) => h.pattern).join('; ') || 'nessuna'}`,
    `Argomenti: ${a.topics.map((t) => t.topic).join('; ') || 'nessuno'}`,
    `Da ripetere: ${a.repeat.join('; ') || 'niente'}`,
    `Da evitare: ${a.avoid.join('; ') || 'niente'}`,
  ].join('\n');
}

/** I propri post migliori per tasso (o interazioni), su tutte le piattaforme. */
export function ownPostRefs(analysis: PostAnalysis): { refs: PlanReference[]; lines: string[] } {
  const posts = analysis.platforms
    .flatMap((p) =>
      p.posts.filter((post) => post.interactions !== null).map((post) => ({ p, post })),
    )
    .sort(
      (a, b) =>
        (b.post.rate ?? 0) - (a.post.rate ?? 0) || b.post.interactions! - a.post.interactions!,
    )
    .slice(0, MAX_REFS);
  return {
    refs: posts.map(({ p, post }) => ({
      label: `${short(post.title, 80)} (${PLATFORM_LABELS[p.platform]})`,
      url: post.url,
    })),
    lines: posts.map(
      ({ p, post }) =>
        `${PLATFORM_LABELS[p.platform]} · ${POST_FORMAT_LABELS[post.format]} · "${short(post.title)}" · argomenti: ${post.tags.join(', ') || 'nessuno'} · apertura: "${short(post.opening)}" · interazioni ${post.interactions}` +
        (post.rate !== null && p.basis ? ` · tasso ${percent(post.rate)} (su ${p.basis})` : ''),
    ),
  };
}

/**
 * Piano editoriale mensile (fase 8e): una chiamata LLM con trend, concorrenti, analisi dei propri
 * post, slot consigliati e uscite già fissate; il piano si salva per brand e mese. «Metti nel
 * calendario» crea solo idee: niente si pubblica senza approvazione.
 */
export function createPlanService(deps: PlanDeps) {
  const { db, prompts, brands, now } = deps;
  const running = new Map<number, Promise<PlanState>>();

  const currentMonth = () => romeDay(now()).slice(0, 7);

  function parseMonth(month: string): string {
    return PlanMonthSchema.parse(month);
  }

  function blockedReason(month: string, configured: boolean): string | null {
    const current = currentMonth();
    if (month < current) return 'Mese passato: il piano si può solo rivedere';
    if (month > addMonths(current, PLAN_MONTHS_AHEAD)) {
      return `Si pianifica al massimo ${PLAN_MONTHS_AHEAD} mesi avanti`;
    }
    if (plannableDays(month, romeDay(now())).length === 0) return 'Il mese è finito';
    if (!configured) return 'AI non configurata: scegli il servizio in Impostazioni › AI';
    return null;
  }

  async function load(brandId: number, month: string) {
    const row = await repo.findPlan(db, brandId, month);
    return row ? repo.rowToPlan(row) : null;
  }

  async function state(brandId: number, month: string): Promise<PlanState> {
    const [plan, booked, llm] = await Promise.all([
      load(brandId, month),
      repo.monthPublications(db, brandId, month),
      deps.llm.current(),
    ]);
    let review = null;
    if (plan) {
      const ideaIds = plan.items.flatMap((i) => (i.ideaId !== null ? [i.ideaId] : []));
      const [existing, variants] = await Promise.all([
        repo.existingIdeas(db, ideaIds),
        repo.ideaVariants(db, ideaIds),
      ]);
      review = reviewPlan(
        plan,
        { ideas: new Set(existing.keys()), variants, publications: booked },
        romeDay(now()),
      );
    }
    return {
      month,
      plan,
      review,
      blocked: blockedReason(month, llm !== null),
      booked: booked.map((b) => ({ day: b.day, platform: b.platform, title: b.title })),
    };
  }

  async function defaultPlatforms(brandId: number): Promise<Platform[]> {
    const accounts = await deps.accounts.list(brandId);
    const connected = [
      ...new Set(accounts.filter((a) => a.status !== 'scollegato').map((a) => a.platform)),
    ];
    return connected.length > 0 ? connected : [...SOCIAL_PLATFORMS];
  }

  async function generate(brandId: number, month: string, input: unknown): Promise<PlanState> {
    const brand = await brands.get(brandId);
    const { platforms: chosen } = PlanGenerateInputSchema.parse(input ?? {});
    const llm = await deps.llm.current();
    const blocked = blockedReason(month, llm !== null);
    if (blocked) throw new BusinessRuleError(blocked);
    if (!llm) throw new LlmNotConfiguredError();

    const today = romeDay(now());
    const platforms = chosen.length > 0 ? chosen : await defaultPlatforms(brandId);
    const [tags, voice, slots, trends, competitors, posts, booked, previous] = await Promise.all([
      deps.tags.list(brandId),
      deps.voice(brandId),
      deps.analytics.slots(brandId),
      deps.trends.state(brandId),
      deps.competitors.state(brandId),
      deps.postAnalysis.report(brandId),
      repo.monthPublications(db, brandId, month),
      load(brandId, month),
    ]);
    // Le idee del piano precedente già create restano: occupano il loro giorno.
    const existing = await repo.existingIdeas(
      db,
      (previous?.items ?? []).flatMap((i) => (i.ideaId !== null ? [i.ideaId] : [])),
    );
    const kept = (previous?.items ?? []).filter((i) => i.ideaId !== null && existing.has(i.ideaId));
    const bookedSet = new Set([
      ...booked.map((b) => bookedKey(b.day, b.platform)),
      ...kept.map((k) => bookedKey(k.day, k.platform)),
    ]);
    const days = plannableDays(month, today);
    const slotsByPlatform = slotMap(slots);
    const slotSources = Object.fromEntries(
      slots.platforms.map((p) => [
        p.platform,
        p.source === 'dati' ? `dai tuoi dati, ${p.basedOn} post` : 'predefiniti',
      ]),
    );
    const t = trendRefs(trends);
    const c = competitorRefs(competitors);
    const o = ownPostRefs(posts);
    const refs: PlanRefs = { trends: t.refs, competitors: c.refs, ownPosts: o.refs };
    const bookedLines = [
      ...booked.map(
        (b) => `- ${Number(b.day.slice(8))} · ${PLATFORM_LABELS[b.platform]} · ${b.title}`,
      ),
      ...kept.map(
        (k) =>
          `- ${Number(k.day.slice(8))} · ${PLATFORM_LABELS[k.platform]} · idea già creata: ${short(k.text)}`,
      ),
    ];
    const userPrompt = prompts.render('generate-plan.user', {
      month,
      days: formatDays(days),
      platforms: platforms.map((p) => `${PLATFORM_LABELS[p]} (${p})`).join(', '),
      slots: formatSlots(platforms, slotsByPlatform, slotSources),
      booked: bookedLines.join('\n') || 'nessuna',
      trends: formatRefs('T', t.lines),
      competitors: `${competitorSummary(competitors)}\n\n${formatRefs('C', c.lines)}`,
      ownPosts: `${formatGroups(posts.platforms) || 'Nessun post misurato.'}\n\n${formatRefs('P', o.lines)}`,
    });
    const request: PlanRequest = {
      days,
      platforms,
      slots: slotsByPlatform,
      tags,
      refs,
      booked: bookedSet,
      data: userPrompt,
    };
    const generated = await llm.completeJson({
      schema: generatedPlanSchema(request),
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-plan.system', {
            brandName: brand.name,
            voice,
            tags: tags.map((tag) => tag.name).join(', ') || 'nessuno',
          }),
        },
        { role: 'user', content: userPrompt },
      ],
    });
    const plan = toPlan(generated, request, kept);
    const at = now();
    if (previous) {
      await db
        .update(editorialPlans)
        .set({ ...plan, model: llm.name, reviewComment: null, createdAt: at, updatedAt: at })
        .where(eq(editorialPlans.id, previous.id));
    } else {
      await db
        .insert(editorialPlans)
        .values({ brandId, month, model: llm.name, ...plan, createdAt: at, updatedAt: at });
    }
    return state(brandId, month);
  }

  async function requirePlan(brandId: number, month: string): Promise<EditorialPlan> {
    const plan = await load(brandId, month);
    if (!plan) throw new NotFoundError('Piano', `${brandId}/${month}`);
    return plan;
  }

  return {
    async state(brandId: number, month: string): Promise<PlanState> {
      await brands.ensureExists(brandId);
      return state(brandId, parseMonth(month));
    },

    /** Un piano alla volta per brand: una seconda richiesta aspetta quella in corso. */
    async generate(brandId: number, month: string, input: unknown): Promise<PlanState> {
      const m = parseMonth(month);
      const current = running.get(brandId);
      if (current) return current;
      const job = generate(brandId, m, input).finally(() => running.delete(brandId));
      running.set(brandId, job);
      return job;
    },

    /**
     * «Metti nel calendario» (con il giorno) o «Crea l'idea»: un'idea `suggerita` per voce, con
     * il tag del pilastro e la piattaforma. Una voce con l'idea già creata riceve solo il giorno.
     */
    async createIdeas(brandId: number, month: string, input: unknown): Promise<PlanState> {
      await brands.ensureExists(brandId);
      const m = parseMonth(month);
      const { itemIds, withDay } = PlanIdeasInputSchema.parse(input);
      const plan = await requirePlan(brandId, m);
      const unknown = itemIds.filter((id) => !plan.items.some((i) => i.id === id));
      if (unknown.length > 0)
        throw new BusinessRuleError(`Voci del piano inesistenti: ${unknown.join(', ')}`);
      const tagIds = new Set((await deps.tags.list(brandId)).map((t) => t.id));
      const existing = await repo.existingIdeas(
        db,
        plan.items.flatMap((i) => (i.ideaId !== null ? [i.ideaId] : [])),
      );
      await db.transaction(async (tx) => {
        const items = [...plan.items];
        for (const id of new Set(itemIds)) {
          const index = items.findIndex((i) => i.id === id);
          const item = items[index]!;
          const plannedDay = withDay ? item.day : null;
          if (item.ideaId !== null && existing.has(item.ideaId)) {
            if (withDay) await ideasRepo.updateIdea(tx, item.ideaId, { plannedDay });
            continue;
          }
          const tagId = plan.pillars.find((p) => p.name === item.pillar)?.tagId ?? null;
          const ideaId = await ideasRepo.insertIdea(tx, {
            brandId,
            text: planIdeaText(item),
            source: 'suggerita',
            targetPlatforms: [item.platform],
            plannedDay,
          });
          if (tagId !== null && tagIds.has(tagId))
            await ideasRepo.replaceIdeaTags(tx, ideaId, [tagId]);
          items[index] = { ...item, ideaId };
        }
        await tx
          .update(editorialPlans)
          .set({ items })
          .where(and(eq(editorialPlans.brandId, brandId), eq(editorialPlans.month, m)));
      });
      return state(brandId, m);
    },

    /** Breve commento dell'AI sulla revisione (solo a mese iniziato); si salva sul piano. */
    async comment(brandId: number, month: string): Promise<PlanState> {
      const brand = await brands.get(brandId);
      const m = parseMonth(month);
      await requirePlan(brandId, m);
      const llm = await deps.llm.current();
      if (!llm) throw new LlmNotConfiguredError();
      const current = await state(brandId, m);
      const plan = current.plan!;
      if (!current.review) throw new BusinessRuleError('Il mese non è ancora iniziato');
      const data = [
        `Piano: ${plan.summary}`,
        `Pilastri: ${plan.pillars.map((p) => p.name).join(', ')}`,
        formatReview(current.review, PLATFORM_LABELS),
      ].join('\n');
      const allowed = new Set(numbersIn(data));
      const schema = z.object({
        comment: z
          .string()
          .trim()
          .min(1)
          .max(600)
          .refine((text) => inventedNumbers(text, allowed).length === 0, {
            message: 'Usa solo i numeri della revisione',
          }),
      });
      const generated = await llm.completeJson({
        schema,
        messages: [
          {
            role: 'system',
            content: prompts.render('review-plan.system', { brandName: brand.name }),
          },
          { role: 'user', content: prompts.render('review-plan.user', { review: data }) },
        ],
      });
      await db
        .update(editorialPlans)
        .set({
          reviewComment: {
            text: generated.comment,
            model: llm.name,
            createdAt: now().toISOString(),
          },
        })
        .where(eq(editorialPlans.id, plan.id));
      return state(brandId, m);
    },
  };
}

export type PlanService = ReturnType<typeof createPlanService>;
