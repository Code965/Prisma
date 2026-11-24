import {
  StockKeyInputSchema,
  StockSearchQuerySchema,
  type StockItem,
  type StockSearchQuery,
  type StockSearchResult,
  type StockStatus,
} from '@prisma-app/shared';
import { eq } from 'drizzle-orm';
import { tokenContext, type TokenCipher } from '../../crypto/token-cipher.js';
import type { DbExecutor } from '../../db/executor.js';
import { appCredentials } from '../../db/schema.js';
import { BusinessRuleError, NotConfiguredError } from '../../http/error-handler.js';

/**
 * Archivio di B-roll (fase 6d): Pixabay, con la chiave gratuita dell'utente salvata cifrata.
 * Verificato su pixabay.com/api/docs (novembre 2026): `GET https://pixabay.com/api/` (foto) e
 * `/api/videos/` con `key`, `q` (≤ 100 caratteri), `lang`, `safesearch`, `per_page` 3–200;
 * 100 richieste al minuto; le risposte vanno tenute in cache 24 ore e i file scaricati (non
 * collegati); va mostrato da dove arrivano. I video hanno `videos.{large,medium,small,tiny}`
 * con `url`, `width`, `height`, `thumbnail`; le foto `largeImageURL` (lato lungo 1280 px).
 */

const API = 'https://pixabay.com/api/';
const CACHE_MS = 24 * 60 * 60 * 1000;
const KEY = 'pixabay';
const context = tokenContext('app', KEY);

interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  thumbnail?: string;
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags?: string;
  user?: string;
  duration?: number;
  videos?: Partial<Record<'large' | 'medium' | 'small' | 'tiny', PixabayVideoFile>>;
  webformatURL?: string;
  largeImageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface StockConfig {
  cipher: TokenCipher;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Il file da scaricare: Full HD se c'è (4K è troppo per un B-roll), altrimenti il più grande. */
export function pickVideoFile(hit: PixabayHit): PixabayVideoFile | null {
  const videos = hit.videos ?? {};
  for (const size of ['medium', 'large', 'small', 'tiny'] as const) {
    const file = videos[size];
    if (file?.url && file.width > 0 && file.height > 0) return file;
  }
  return null;
}

export function toStockItem(hit: PixabayHit, kind: 'video' | 'image'): StockItem | null {
  const base = {
    id: hit.id,
    kind,
    pageUrl: hit.pageURL,
    user: hit.user ?? '',
    tags: hit.tags ?? '',
  };
  if (kind === 'video') {
    const file = pickVideoFile(hit);
    if (!file) return null;
    return {
      ...base,
      previewUrl: file.thumbnail ?? '',
      downloadUrl: file.url,
      width: file.width,
      height: file.height,
      durationMs: Math.round((hit.duration ?? 0) * 1000),
    };
  }
  if (!hit.largeImageURL || !hit.imageWidth || !hit.imageHeight) return null;
  // largeImageURL ha il lato lungo a 1280 px (o meno, se l'originale è più piccolo).
  const scale = Math.min(1, 1280 / Math.max(hit.imageWidth, hit.imageHeight));
  return {
    ...base,
    previewUrl: hit.webformatURL ?? hit.largeImageURL,
    downloadUrl: hit.largeImageURL,
    width: Math.round(hit.imageWidth * scale),
    height: Math.round(hit.imageHeight * scale),
    durationMs: 0,
  };
}

export function searchUrl(
  key: string,
  query: ReturnType<typeof StockSearchQuerySchema.parse>,
): string {
  const params = new URLSearchParams({
    key,
    q: query.q,
    lang: query.lang,
    safesearch: 'true',
    per_page: '30',
  });
  if (query.kind === 'image') {
    params.set('image_type', 'photo');
    if (query.orientation !== 'square') params.set('orientation', query.orientation);
    return `${API}?${params}`;
  }
  return `${API}videos/?${params}`;
}

export function createStockService(deps: { db: DbExecutor; config: StockConfig | null }) {
  const cache = new Map<string, { at: number; result: StockSearchResult }>();
  const now = () => deps.config?.now?.() ?? Date.now();

  function requireConfig(): StockConfig {
    if (!deps.config) throw new NotConfiguredError('Cifratura non configurata sul server');
    return deps.config;
  }

  async function readKey(): Promise<string | null> {
    const { cipher } = requireConfig();
    const [row] = await deps.db.select().from(appCredentials).where(eq(appCredentials.key, KEY));
    if (!row) return null;
    return (JSON.parse(cipher.decrypt(row.dataEnc, context)) as { apiKey: string }).apiKey;
  }

  async function call(url: string): Promise<{ hits: PixabayHit[] }> {
    const fetcher = deps.config?.fetch ?? fetch;
    let response: Response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new BusinessRuleError('Pixabay non risponde: controlla la connessione');
    }
    if (response.status === 429) {
      throw new BusinessRuleError('Troppe ricerche su Pixabay: riprova tra un minuto');
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      const text = (await response.text()).slice(0, 200);
      throw new BusinessRuleError(
        /key/i.test(text)
          ? 'Chiave di Pixabay non valida'
          : `Pixabay ha rifiutato la ricerca: ${text}`,
      );
    }
    if (!response.ok) throw new BusinessRuleError(`Pixabay ha risposto ${response.status}`);
    return (await response.json()) as { hits: PixabayHit[] };
  }

  return {
    async status(): Promise<StockStatus> {
      return { configured: (await readKey()) !== null };
    },

    /** Salva la chiave dopo averla provata con una ricerca minima. */
    async setKey(body: unknown): Promise<StockStatus> {
      const { cipher } = requireConfig();
      const { apiKey } = StockKeyInputSchema.parse(body);
      await call(searchUrl(apiKey, StockSearchQuerySchema.parse({ q: 'code', kind: 'image' })));
      const dataEnc = cipher.encrypt(JSON.stringify({ apiKey }), context);
      await deps.db
        .insert(appCredentials)
        .values({ key: KEY, dataEnc })
        .onConflictDoUpdate({
          target: appCredentials.key,
          set: { dataEnc, updatedAt: new Date() },
        });
      cache.clear();
      return { configured: true };
    },

    async removeKey(): Promise<StockStatus> {
      requireConfig();
      await deps.db.delete(appCredentials).where(eq(appCredentials.key, KEY));
      cache.clear();
      return { configured: false };
    },

    /** Ricerca con la cache di 24 ore chiesta da Pixabay. */
    async search(input: StockSearchQuery): Promise<StockSearchResult> {
      const query = StockSearchQuerySchema.parse(input);
      const key = await readKey();
      if (!key) {
        throw new NotConfiguredError(
          'Inserisci la chiave di Pixabay in Impostazioni › Strumenti video',
        );
      }
      const cacheKey = `${query.kind}|${query.orientation}|${query.lang}|${query.q.toLowerCase()}`;
      const cached = cache.get(cacheKey);
      if (cached && now() - cached.at < CACHE_MS) return cached.result;
      const { hits } = await call(searchUrl(key, query));
      const items = (hits ?? []).flatMap((hit) => toStockItem(hit, query.kind) ?? []);
      const result: StockSearchResult = { source: 'pixabay', items };
      cache.set(cacheKey, { at: now(), result });
      return result;
    },
  };
}

export type StockService = ReturnType<typeof createStockService>;
