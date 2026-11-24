import { z } from 'zod';
import { IdSchema } from './common.js';
import { SHORT_LIMITS, ShortSegmentSchema, type ShortSegment } from './shorts.js';
import { transcriptSegments, type TranscriptWord } from './transcript.js';
import {
  addCut,
  isCut,
  keptRanges,
  type TimeRange,
  type VideoEdit,
  type Zoom,
} from './video-edit.js';

/**
 * «Monta con l'AI» (fase 6a): l'LLM legge le frasi della trascrizione e propone cosa tagliare
 * (false partenze, ripetizioni, riempitivi), l'hook, le parole chiave e le frasi da enfatizzare;
 * `applyAutoEdit` lo trasforma in modifiche del progetto insieme ai tagli automatici (silenzi,
 * «ehm») e agli zoom ai tagli. Tutto resta modificabile nell'editor prima dell'export.
 */

export const AUTO_EDIT_LIMITS = {
  hookMaxChars: 60,
  hookDurationMs: 2500,
  /** Zoom alternato a ogni taglio, per nascondere lo stacco (jump cut). */
  punchInScale: 1.08,
  /** Zoom sulle frasi importanti. */
  emphasisScale: 1.18,
  maxKeywordsPerSegment: 2,
  /** Pezzi rimasti più corti di così (tra due tagli) si tolgono: sarebbero solo un lampo. */
  minPartMs: 250,
} as const;

export const AutoEditRequestSchema = z.object({
  brandId: IdSchema,
  videoTitle: z.string().trim().min(1).max(200),
  durationMs: z.int().positive(),
  /** Frasi parlate in ordine, con i tempi del sorgente (come per «Genera Short»). */
  segments: z.array(ShortSegmentSchema).min(1).max(SHORT_LIMITS.maxSegments),
});
export type AutoEditRequest = z.input<typeof AutoEditRequestSchema>;

const SegmentWordsSchema = z.object({
  segment: z.int().nonnegative(),
  words: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
});

/** Proposta del modello, controllata dal server sulle frasi della richiesta. */
export const AutoEditPlanSchema = z.object({
  /** Frasi da togliere: false partenze, ripetizioni, frasi interrotte. */
  removeSegments: z.array(
    z.object({ segment: z.int().nonnegative(), reason: z.string().trim().min(1).max(200) }),
  ),
  /** Riempitivi dentro le frasi («cioè», «praticamente», «tipo»…), da tagliare come parole. */
  fillers: z.array(SegmentWordsSchema),
  /** Parole chiave da evidenziare nei sottotitoli. */
  keywords: z.array(SegmentWordsSchema),
  /** Frasi importanti su cui zoomare. */
  emphasis: z.array(z.int().nonnegative()),
  /** Titolo di apertura (riscritto in breve) e la frase da cui nasce. */
  hook: z
    .object({
      text: z.string().trim().min(1).max(AUTO_EDIT_LIMITS.hookMaxChars),
      segment: z.int().nonnegative(),
    })
    .nullable(),
});
export type AutoEditPlan = z.infer<typeof AutoEditPlanSchema>;

/** Le frasi da inviare al modello: come «Genera Short», senza i silenzi. */
export function autoEditSegments(
  words: readonly TranscriptWord[],
  durationMs: number,
): Array<ShortSegment & { firstWord: number; lastWord: number }> {
  return transcriptSegments(words, durationMs).flatMap((segment) =>
    segment.kind === 'speech'
      ? [
          {
            startMs: segment.startMs,
            endMs: Math.max(segment.endMs, segment.startMs + 1),
            text: segment.text.slice(0, SHORT_LIMITS.segmentTextMax),
            firstWord: segment.firstWord,
            lastWord: segment.lastWord,
          },
        ]
      : [],
  );
}

/** Testo di una parola senza punteggiatura, in minuscolo, per confrontarla. */
export function bareWord(text: string): string {
  return text
    .toLocaleLowerCase('it')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

/** Esitazioni sempre da togliere, senza chiedere al modello. */
const HESITATION = /^(e+h+m*|e+m+|u+h*m+|u+h+|m+h*|a+h+m+|e{2,})$/;

export function isHesitation(text: string): boolean {
  return HESITATION.test(bareWord(text));
}

/** Indici delle parole della frase che corrispondono alle parole indicate dal modello. */
export function matchSegmentWords(
  words: readonly TranscriptWord[],
  segment: { firstWord: number; lastWord: number },
  wanted: readonly string[],
): number[] {
  const targets = new Set(
    wanted
      .flatMap((w) => w.split(/\s+/))
      .map(bareWord)
      .filter(Boolean),
  );
  const found: number[] = [];
  for (let i = segment.firstWord; i <= segment.lastWord; i++) {
    if (targets.has(bareWord(words[i]!.text))) found.push(i);
  }
  return found;
}

export interface AutoEditSummary {
  silences: number;
  hesitations: number;
  fillers: number;
  removedSegments: number;
  keywords: number;
  zooms: number;
  hook: boolean;
  removedMs: number;
}

const wordRange = (word: TranscriptWord): TimeRange => ({
  startMs: word.startMs,
  endMs: Math.max(word.endMs, word.startMs + 1),
});

/**
 * Applica la proposta: tagli (silenzi, esitazioni, riempitivi, frasi tolte) aggiunti a quelli
 * già fatti, parole chiave, zoom alternati ai tagli e zoom sulle frasi importanti, hook.
 */
export function applyAutoEdit(
  edit: VideoEdit,
  words: readonly TranscriptWord[],
  durationMs: number,
  plan: AutoEditPlan,
): { edit: VideoEdit; summary: AutoEditSummary } {
  const segments = autoEditSegments(words, durationMs);
  const before = keptRanges(edit.cuts, durationMs).reduce((t, r) => t + r.endMs - r.startMs, 0);
  let cuts = [...edit.cuts];
  const summary: AutoEditSummary = {
    silences: 0,
    hesitations: 0,
    fillers: 0,
    removedSegments: 0,
    keywords: 0,
    zooms: 0,
    hook: false,
    removedMs: 0,
  };

  for (const segment of transcriptSegments(words, durationMs)) {
    if (segment.kind === 'silence' && !isCut(cuts, segment)) {
      cuts = addCut(cuts, segment);
      summary.silences++;
    }
  }
  words.forEach((word) => {
    if (isHesitation(word.text) && !isCut(cuts, wordRange(word))) {
      cuts = addCut(cuts, wordRange(word));
      summary.hesitations++;
    }
  });
  for (const item of plan.removeSegments) {
    const segment = segments[item.segment];
    if (segment && !isCut(cuts, segment)) {
      cuts = addCut(cuts, segment);
      summary.removedSegments++;
    }
  }
  for (const item of plan.fillers) {
    const segment = segments[item.segment];
    if (!segment) continue;
    for (const index of matchSegmentWords(words, segment, item.words)) {
      const range = wordRange(words[index]!);
      if (!isCut(cuts, range)) {
        cuts = addCut(cuts, range);
        summary.fillers++;
      }
    }
  }

  const keywords = new Set(edit.keywords);
  for (const item of plan.keywords) {
    const segment = segments[item.segment];
    if (!segment) continue;
    const found = matchSegmentWords(words, segment, item.words).slice(
      0,
      AUTO_EDIT_LIMITS.maxKeywordsPerSegment,
    );
    for (const index of found) {
      const word = words[index]!;
      if (!keywords.has(word.startMs) && !isCut(cuts, wordRange(word))) {
        keywords.add(word.startMs);
        summary.keywords++;
      }
    }
  }

  for (const range of keptRanges(cuts, durationMs)) {
    if (range.endMs - range.startMs < AUTO_EDIT_LIMITS.minPartMs) cuts = addCut(cuts, range);
  }

  // Zoom: un taglio sì e uno no la parte successiva entra più vicina; le frasi importanti di più.
  const kept = keptRanges(cuts, durationMs);
  const zooms: Zoom[] = kept
    .filter((_, index) => index % 2 === 1)
    .map((range) => ({ ...range, scale: AUTO_EDIT_LIMITS.punchInScale }));
  for (const index of plan.emphasis) {
    const segment = segments[index];
    if (segment && !isCut(cuts, segment)) {
      zooms.push({
        startMs: segment.startMs,
        endMs: segment.endMs,
        scale: AUTO_EDIT_LIMITS.emphasisScale,
      });
    }
  }
  summary.zooms = zooms.length;

  const hook =
    plan.hook && segments[plan.hook.segment]
      ? { text: plan.hook.text, durationMs: AUTO_EDIT_LIMITS.hookDurationMs }
      : edit.hook;
  summary.hook = Boolean(plan.hook && hook);

  const after = kept.reduce((t, r) => t + r.endMs - r.startMs, 0);
  summary.removedMs = Math.max(0, before - after);
  return {
    edit: { ...edit, cuts, keywords: [...keywords].sort((a, b) => a - b), zooms, hook },
    summary,
  };
}
