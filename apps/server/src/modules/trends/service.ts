import {
  TREND_REFRESH_COOLDOWN_MS,
  TREND_SOURCES,
  TREND_YOUTUBE_DAILY_SEARCHES,
  TrendSettingsInputSchema,
  type TrendItem,
  type TrendReport,
  type TrendSource,
  type TrendSourceStatus,
  type TrendsState,
} from '@prisma-app/shared';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { trendReports, trendSettings } from '../../db/schema.js';
import { BusinessRuleError } from '../../http/error-handler.js';
import type { PromptLibrary } from '../../llm/prompts.js';
import { LlmNotConfiguredError, type LlmSource } from '../../llm/types.js';
import type { BrandService } from '../brands/service.js';
import type { TagService } from '../tags/service.js';
import { formatItems, generatedTrendsSchema, selectItems, toTrends } from './analysis.js';
import { SOURCE_SEARCHES, SourceError, type SourceSearch } from './sources.js';

const HOUR = 60 * 60_000;
/** Contenuti pubblicati negli ultimi 7 giorni. */
export const TREND_WINDOW_DAYS = 7;
/** Il giro automatico aggiorna un brand se l'ultimo radar ha almeno 20 ore. */
export const TREND_AUTO_INTERVAL_MS = 20 * HOUR;
/** Le risposte delle fonti restano in cache un'ora (stessa ricerca, stesso risultato). */
const CACHE_MS = HOUR;
/** Aggiornamenti tenuti per brand. */
const KEEP_REPORTS = 10;

export interface TrendsConfig {
  fetch?: typeof fetch;
  /** Fonti sostituibili nei test. */
  searches?: Partial<Record<TrendSource, SourceSearch>>;
}

interface TrendsDeps {
  db: DbExecutor;
  llm: LlmSource;
  prompts: PromptLibrary;
  brands: BrandService;
  tags: TagService;
  now: () => Date;
  /** Token OAuth dell'account YouTube collegato al brand; null se non c'è. */
  youtubeToken: (brandId: number) => Promise<string | null>;
  config?: TrendsConfig | null;
}

/** Ricerche di YouTube rimaste nelle ultime 24 ore. */
export function youtubeBudget(recent: ReadonlyArray<{ sources: TrendSourceStatus[] }>): number {
  const used = recent
    .flatMap((report) => report.sources)
    .filter((status) => status.source === 'youtube')
    .reduce((sum, status) => sum + status.requests, 0);
  return Math.max(0, TREND_YOUTUBE_DAILY_SEARCHES - used);
}

/**
 * Radar dei trend (fase 8a): cerca sulle fonti con le parole del brand, poi una chiamata LLM
 * raggruppa i contenuti in trend e li valuta. Una volta al giorno dal giro orario, o con
 * «Aggiorna» (al massimo ogni 15 minuti).
 */
export function createTrendsService(deps: TrendsDeps) {
  const { db, prompts, brands, now } = deps;
  const fetchFn = deps.config?.fetch ?? fetch;
  const searches = { ...SOURCE_SEARCHES, ...deps.config?.searches };
  const cache = new Map<string, { at: number; items: TrendItem[] }>();
  const running = new Map<number, Promise<TrendReport>>();
  /** Ultimo tentativo automatico per brand: un errore non si ripete a ogni giro orario. */
  const attempted = new Map<number, number>();

  async function keywords(brandId: number): Promise<string[]> {
    const [row] = await db
      .select({ keywords: trendSettings.keywords })
      .from(trendSettings)
      .where(eq(trendSettings.brandId, brandId));
    return row?.keywords ?? [];
  }

  async function latest(brandId: number): Promise<TrendReport | null> {
    const [row] = await db
      .select()
      .from(trendReports)
      .where(eq(trendReports.brandId, brandId))
      .orderBy(desc(trendReports.createdAt), desc(trendReports.id))
      .limit(1);
    return row
      ? {
          id: row.id,
          createdAt: toIso(row.createdAt),
          model: row.model,
          keywords: row.keywords,
          sources: row.sources,
          items: row.items,
          trends: row.trends,
        }
      : null;
  }

  function nextRefreshAt(report: TrendReport | null): string | null {
    if (!report) return null;
    const next = new Date(report.createdAt).getTime() + TREND_REFRESH_COOLDOWN_MS;
    return next > now().getTime() ? new Date(next).toISOString() : null;
  }

  function blockedReason(words: string[], configured: boolean): string | null {
    if (!configured) return 'AI non configurata: scegli il servizio in Impostazioni › AI';
    if (words.length === 0) return 'Scegli almeno una parola da cercare';
    return null;
  }

  /** Una ricerca con la cache di un'ora. */
  async function search(
    source: TrendSource,
    keyword: string,
    ctx: Parameters<SourceSearch>[1],
  ): Promise<TrendItem[]> {
    const key = `${source}:${keyword.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && now().getTime() - hit.at < CACHE_MS) return hit.items;
    const items = await searches[source](keyword, ctx);
    cache.set(key, { at: now().getTime(), items });
    return items;
  }

  async function collect(
    brandId: number,
    words: string[],
  ): Promise<{ items: TrendItem[]; sources: TrendSourceStatus[] }> {
    const at = now();
    const since = new Date(at.getTime() - TREND_WINDOW_DAYS * 24 * HOUR);
    const recent = await db
      .select({ sources: trendReports.sources })
      .from(trendReports)
      .where(
        and(
          eq(trendReports.brandId, brandId),
          gte(trendReports.createdAt, new Date(at.getTime() - 24 * HOUR)),
        ),
      );
    const youtubeToken = await deps.youtubeToken(brandId);
    const budget = youtubeBudget(recent);

    const results = await Promise.all(
      TREND_SOURCES.map(
        async (source): Promise<{ items: TrendItem[]; status: TrendSourceStatus }> => {
          if (source === 'youtube' && !youtubeToken) {
            return {
              items: [],
              status: { source, items: 0, requests: 0, error: 'Collega un account YouTube' },
            };
          }
          const list = source === 'youtube' ? words.slice(0, budget) : words;
          if (source === 'youtube' && list.length === 0) {
            return {
              items: [],
              status: {
                source,
                items: 0,
                requests: 0,
                error: `Già fatte ${TREND_YOUTUBE_DAILY_SEARCHES} ricerche nelle ultime 24 ore`,
              },
            };
          }
          const items: TrendItem[] = [];
          let requests = 0;
          let error: string | null = null;
          // In sequenza dentro la fonte: GitHub senza token ammette poche ricerche al minuto.
          for (const keyword of list) {
            try {
              const cached = cache.get(`${source}:${keyword.toLowerCase()}`);
              const fresh = !cached || at.getTime() - cached.at >= CACHE_MS;
              items.push(
                ...(await search(source, keyword, {
                  fetch: fetchFn,
                  now: at,
                  since,
                  ...(youtubeToken ? { youtubeToken } : {}),
                })),
              );
              if (fresh) requests++;
            } catch (e) {
              if (source === 'youtube') requests++;
              error = e instanceof SourceError ? e.message : 'Errore inatteso';
              if (source === 'youtube') break;
            }
          }
          return { items, status: { source, items: items.length, requests, error } };
        },
      ),
    );
    return {
      items: results.flatMap((r) => r.items),
      sources: results.map((r) => r.status),
    };
  }

  async function generate(brandId: number): Promise<TrendReport> {
    const brand = await brands.get(brandId);
    const words = await keywords(brandId);
    const llm = await deps.llm.current();
    if (!llm) throw new LlmNotConfiguredError();
    const blocked = blockedReason(words, true);
    if (blocked) throw new BusinessRuleError(blocked);

    const collected = await collect(brandId, words);
    const items = selectItems(collected.items);
    if (items.length === 0) {
      throw new BusinessRuleError(
        collected.sources.every((s) => s.error)
          ? 'Nessuna fonte ha risposto: riprova più tardi'
          : 'Nessun contenuto popolare negli ultimi 7 giorni con queste parole: prova parole più generali (in inglese)',
      );
    }
    const tags = await deps.tags.list(brandId);
    const generated = await llm.completeJson({
      schema: generatedTrendsSchema(items.length, tags),
      messages: [
        {
          role: 'system',
          content: prompts.render('generate-trends.system', {
            brandName: brand.name,
            tags: tags.map((t) => t.name).join(', ') || 'nessuno',
          }),
        },
        {
          role: 'user',
          content: prompts.render('generate-trends.user', {
            keywords: words.join(', '),
            items: formatItems(items),
          }),
        },
      ],
    });
    const trends = toTrends(generated, items);
    // Si tengono solo i contenuti dei trend: gli altri non si mostrano.
    const used = new Set(trends.flatMap((t) => t.itemIds));
    const kept = items.filter((item) => used.has(item.id));
    const createdAt = now();
    const [row] = await db
      .insert(trendReports)
      .values({
        brandId,
        model: llm.name,
        keywords: words,
        sources: collected.sources,
        items: kept,
        trends,
        createdAt,
      })
      .returning({ id: trendReports.id });
    const old = await db
      .select({ createdAt: trendReports.createdAt })
      .from(trendReports)
      .where(eq(trendReports.brandId, brandId))
      .orderBy(desc(trendReports.createdAt), desc(trendReports.id))
      .limit(1)
      .offset(KEEP_REPORTS - 1);
    if (old[0]) {
      await db
        .delete(trendReports)
        .where(
          and(eq(trendReports.brandId, brandId), lt(trendReports.createdAt, old[0].createdAt)),
        );
    }
    return {
      id: row!.id,
      createdAt: createdAt.toISOString(),
      model: llm.name,
      keywords: words,
      sources: collected.sources,
      items: kept,
      trends,
    };
  }

  /** Un aggiornamento alla volta per brand: una seconda richiesta aspetta quella in corso. */
  function refresh(brandId: number): Promise<TrendReport> {
    const current = running.get(brandId);
    if (current) return current;
    const job = generate(brandId).finally(() => running.delete(brandId));
    running.set(brandId, job);
    return job;
  }

  return {
    async state(brandId: number): Promise<TrendsState> {
      await brands.ensureExists(brandId);
      const [words, report, llm] = await Promise.all([
        keywords(brandId),
        latest(brandId),
        deps.llm.current(),
      ]);
      return {
        keywords: words,
        report,
        blocked: blockedReason(words, llm !== null),
        nextRefreshAt: nextRefreshAt(report),
      };
    },

    async saveKeywords(brandId: number, input: unknown): Promise<{ keywords: string[] }> {
      await brands.ensureExists(brandId);
      const { keywords: words } = TrendSettingsInputSchema.parse(input);
      await db
        .insert(trendSettings)
        .values({ brandId, keywords: words })
        .onConflictDoUpdate({
          target: trendSettings.brandId,
          set: { keywords: words, updatedAt: now() },
        });
      return { keywords: words };
    },

    /** «Aggiorna»: rifiutato se l'ultimo aggiornamento ha meno di 15 minuti. */
    async refreshNow(brandId: number): Promise<TrendReport> {
      await brands.ensureExists(brandId);
      const next = nextRefreshAt(await latest(brandId));
      if (next && !running.has(brandId)) {
        const minutes = Math.ceil((new Date(next).getTime() - now().getTime()) / 60_000);
        throw new BusinessRuleError(
          `Il radar è appena stato aggiornato: riprova tra ${minutes} minut${minutes === 1 ? 'o' : 'i'}`,
        );
      }
      return refresh(brandId);
    },

    /**
     * Giro orario: aggiorna i brand con parole del radar e l'ultimo aggiornamento più vecchio di
     * 20 ore. Un errore su un brand non ferma gli altri.
     */
    async refreshDue(log?: (brandId: number, error: unknown) => void): Promise<number> {
      if (!(await deps.llm.current())) return 0;
      let done = 0;
      for (const brand of await brands.list()) {
        if ((await keywords(brand.id)).length === 0) continue;
        const report = await latest(brand.id);
        const at = now().getTime();
        const last = Math.max(
          report ? new Date(report.createdAt).getTime() : 0,
          attempted.get(brand.id) ?? 0,
        );
        if (at - last < TREND_AUTO_INTERVAL_MS) continue;
        attempted.set(brand.id, at);
        try {
          await refresh(brand.id);
          done++;
        } catch (error) {
          log?.(brand.id, error);
        }
      }
      return done;
    },
  };
}

export type TrendsService = ReturnType<typeof createTrendsService>;
