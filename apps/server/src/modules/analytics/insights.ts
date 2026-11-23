import {
  INSIGHTS_MIN_POSTS,
  INSIGHT_KINDS,
  PLATFORM_LABELS,
  type AnalyticsInsights,
  type AnalyticsReport,
  type InsightsState,
  type PlatformSlots,
} from '@prisma-app/shared';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { analyticsInsights } from '../../db/schema.js';
import { BusinessRuleError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import { addDays, postReach, romeDay, type PostRow } from './aggregate.js';
import { romeSlot } from './slots.js';

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const METRIC_TITLES = {
  reach: 'copertura',
  followers: 'nuovi follower',
  interactions: 'interazioni',
} as const;

/** Risposta del modello: esattamente un suggerimento per tipo; `idea` solo per gli argomenti. */
export const GeneratedInsightsSchema = z
  .object({
    tips: z
      .array(
        z.object({
          kind: z.enum(INSIGHT_KINDS),
          text: z.string().trim().min(1).max(400),
          why: z.string().trim().min(1).max(300),
          idea: z
            .string()
            .nullish()
            .transform((v) => (v && v.trim() ? v.trim().slice(0, 500) : null)),
        }),
      )
      .length(3),
  })
  .superRefine((value, ctx) => {
    for (const kind of INSIGHT_KINDS) {
      if (value.tips.filter((t) => t.kind === kind).length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['tips'],
          message: `Serve esattamente un suggerimento "${kind}"`,
        });
      }
    }
  })
  .transform((value) => ({
    tips: INSIGHT_KINDS.map((kind) => {
      const tip = value.tips.find((t) => t.kind === kind)!;
      return { ...tip, idea: kind === 'argomenti' ? tip.idea : null };
    }),
  }));

/** Lunedì (ora italiana) della settimana di `now`. */
export function weekStartOf(now: Date): string {
  const today = romeDay(now);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -weekday);
}

function value(v: number | null): string {
  return v === null ? '—' : String(Math.round(v));
}

/** Serie settimanali per il prompt: una riga per piattaforma e metrica, con la nota sulla misura. */
export function formatSeries(report: Pick<AnalyticsReport, 'platforms' | 'buckets'>): string {
  const weeks = report.buckets.map((b) => b.label).join(', ');
  const lines = [`Settimane: ${weeks}`];
  for (const p of report.platforms) {
    for (const metric of ['reach', 'followers', 'interactions'] as const) {
      const series = p.series[metric];
      if (series.every((v) => v === null)) continue;
      const note = p.notes[metric] ? ` (${p.notes[metric]})` : '';
      lines.push(
        `- ${PLATFORM_LABELS[p.platform]}, ${METRIC_TITLES[metric]}${note}: ${series.map(value).join(', ')}`,
      );
    }
  }
  return lines.length > 1 ? lines.join('\n') : 'Nessuna serie con dati.';
}

/** Contenuti con metriche, dal migliore dentro ogni piattaforma (al massimo 40). */
export function formatPosts(posts: readonly PostRow[]): string {
  const lines = posts
    .filter((p) => p.metrics)
    .map((p) => ({ p, reach: postReach(p.metrics) }))
    .sort(
      (a, b) =>
        a.p.platform.localeCompare(b.p.platform) || (b.reach.value ?? -1) - (a.reach.value ?? -1),
    )
    .slice(0, 40)
    .map(({ p, reach }) => {
      const slot = romeSlot(p.publishedAt);
      const m = p.metrics!;
      const parts = [
        reach.value !== null ? `${reach.kind} ${reach.value}` : null,
        m.likes !== null ? `like ${m.likes}` : null,
        m.comments !== null ? `commenti ${m.comments}` : null,
        m.shares !== null ? `condivisioni ${m.shares}` : null,
        m.saves !== null ? `salvataggi ${m.saves}` : null,
      ].filter(Boolean);
      return `- ${PLATFORM_LABELS[p.platform]} · ${p.format} · ${WEEKDAYS[slot.weekday]} ${String(slot.hour).padStart(2, '0')}:00 · "${p.title}" · ${parts.join(', ')}`;
    });
  return lines.join('\n') || 'Nessun contenuto con metriche.';
}

export function formatSlots(slots: readonly PlatformSlots[]): string {
  return slots
    .map((p) => {
      const list = p.slots
        .map((s) => `${WEEKDAYS[s.weekday]} ${String(s.hour).padStart(2, '0')}:00`)
        .join(', ');
      const source = p.source === 'dati' ? `dai dati (${p.basedOn} post)` : 'predefiniti';
      return `- ${PLATFORM_LABELS[p.platform]}: ${list || 'nessuno'} · ${source}`;
    })
    .join('\n');
}

interface InsightsDeps {
  db: DbExecutor;
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  now: () => Date;
  /** Dati del brand: report di 8 settimane, post recenti con metriche e slot consigliati. */
  data: (brandId: number) => Promise<{
    report: AnalyticsReport;
    posts: PostRow[];
    slots: PlatformSlots[];
  }>;
}

/**
 * Suggerimenti dell'AI (fase 4d): una chiamata a settimana per brand con i dati aggregati delle
 * ultime 8 settimane. Generati dal giro orario il primo momento utile della settimana (lunedì,
 * o appena ci sono abbastanza dati), o a mano con «Aggiorna».
 */
export function createInsightsService(deps: InsightsDeps) {
  const { db, prompts, brands, now } = deps;

  async function latest(brandId: number): Promise<AnalyticsInsights | null> {
    const [row] = await db
      .select()
      .from(analyticsInsights)
      .where(eq(analyticsInsights.brandId, brandId))
      .orderBy(desc(analyticsInsights.createdAt), desc(analyticsInsights.id))
      .limit(1);
    return row
      ? {
          id: row.id,
          createdAt: toIso(row.createdAt),
          weekStart: row.weekStart,
          model: row.model,
          basedOn: row.basedOn,
          tips: row.tips,
        }
      : null;
  }

  function blockedReason(measured: number, configured: boolean): string | null {
    if (!configured) return 'AI non configurata: scegli il servizio in Impostazioni › AI';
    if (measured < INSIGHTS_MIN_POSTS) {
      return `Servono almeno ${INSIGHTS_MIN_POSTS} contenuti con metriche nelle ultime 8 settimane (ora ${measured})`;
    }
    return null;
  }

  async function generate(brandId: number): Promise<AnalyticsInsights> {
    const brand = await brands.get(brandId);
    const { report, posts, slots } = await deps.data(brandId);
    const measured = posts.filter((p) => p.metrics).length;
    const llm = await deps.llm.current();
    if (!llm) throw new LlmNotConfiguredError();
    const blocked = blockedReason(measured, true);
    if (blocked) throw new BusinessRuleError(blocked);
    const weekStart = weekStartOf(now());
    const generated = await llm.completeJson({
      schema: GeneratedInsightsSchema,
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-insights.system', { brandName: brand.name }),
        },
        {
          role: 'user',
          content: prompts.render('generate-insights.user', {
            weekStart,
            series: formatSeries(report),
            posts: formatPosts(posts),
            slots: formatSlots(slots),
          }),
        },
      ],
    });
    const createdAt = now();
    const [row] = await db
      .insert(analyticsInsights)
      .values({
        brandId,
        weekStart,
        model: llm.name,
        basedOn: measured,
        tips: generated.tips,
        createdAt,
      })
      .$returningId();
    return {
      id: row!.id,
      createdAt: createdAt.toISOString(),
      weekStart,
      model: llm.name,
      basedOn: measured,
      tips: generated.tips,
    };
  }

  return {
    async state(brandId: number): Promise<InsightsState> {
      await brands.ensureExists(brandId);
      const { posts } = await deps.data(brandId);
      return {
        insights: await latest(brandId),
        blocked: blockedReason(
          posts.filter((p) => p.metrics).length,
          (await deps.llm.current()) !== null,
        ),
      };
    },

    generate,

    /**
     * Giro orario: per ogni brand senza suggerimenti di questa settimana, se ci sono abbastanza dati,
     * li genera. Un errore su un brand non ferma gli altri.
     */
    async refreshDue(log?: (brandId: number, error: unknown) => void): Promise<number> {
      if (!(await deps.llm.current())) return 0;
      const week = weekStartOf(now());
      let generated = 0;
      for (const brand of await brands.list()) {
        const current = await latest(brand.id);
        if (current && current.weekStart >= week) continue;
        try {
          const { posts } = await deps.data(brand.id);
          if (blockedReason(posts.filter((p) => p.metrics).length, true)) continue;
          await generate(brand.id);
          generated++;
        } catch (error) {
          log?.(brand.id, error);
        }
      }
      return generated;
    },
  };
}

export type InsightsService = ReturnType<typeof createInsightsService>;
