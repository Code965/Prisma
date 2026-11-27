import {
  PLATFORMS,
  TREND_SOURCE_LABELS,
  inspirationIdeaText,
  type CompetitorPost,
  type IdeaInput,
  type Inspiration,
  type InspirationSignals,
  type InspireRequest,
  type InspireSource,
  type Platform,
  type TrendItem,
} from '@prisma-app/shared';
import { percent } from './competitors';
import { compactNumber } from './trends';

/**
 * «Ispirati» (fase 8c): il post d'origine come lo mostra il pannello e come lo riceve il server,
 * la scelta dell'argomento e l'idea da salvare. Il server spiega il meccanismo e propone l'idea;
 * qui si prepara solo la richiesta e si mostrano i numeri salvati, mai stimati.
 */

/** Il post da cui ci si ispira, con quello che serve al pannello. */
export interface InspireTarget {
  source: InspireSource;
  title: string;
  label: string;
  url: string | null;
  platform: Platform | null;
}

const short = (text: string, max = 120) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function competitorTarget(
  post: CompetitorPost,
  competitor: { name: string; platform: Platform },
): InspireTarget {
  return {
    source: { kind: 'concorrente', postId: post.id },
    title: post.title ?? short(post.text ?? ''),
    label: competitor.name,
    url: post.url,
    platform: competitor.platform,
  };
}

/** Un contenuto del radar dei trend: titolo e descrizione come testo. */
export function trendTarget(item: TrendItem): InspireTarget {
  const label = TREND_SOURCE_LABELS[item.source];
  return {
    source: {
      kind: 'testo',
      title: item.title.slice(0, 200),
      text: [item.title, item.description].filter(Boolean).join('\n').slice(0, 3000),
      url: item.url,
      platform: item.source === 'youtube' ? 'youtube' : null,
      label: item.author ? `${label} · ${item.author}`.slice(0, 80) : label,
    },
    title: item.title,
    label,
    url: item.url,
    platform: item.source === 'youtube' ? 'youtube' : null,
  };
}

/** Un post o un link incollato a mano. */
export function pastedTarget(text: string, url: string): InspireTarget | { error: string } {
  const body = text.trim();
  const link = url.trim();
  if (!body) return { error: 'Incolla il testo del post (o almeno il titolo)' };
  if (body.length > 3000) return { error: 'Il testo è troppo lungo: al massimo 3.000 caratteri' };
  if (link && !/^https?:\/\/\S+$/i.test(link)) {
    return { error: 'Il link deve iniziare con http:// o https://' };
  }
  return {
    source: { kind: 'testo', text: body, url: link || null, label: 'Testo incollato' },
    title: short(body),
    label: 'Testo incollato',
    url: link || null,
    platform: null,
  };
}

/** Argomento: un tag del brand, uno scritto, o lo sceglie l'AI tra i tag. */
export type TopicChoice =
  { kind: 'ai' } | { kind: 'tag'; tagId: number } | { kind: 'testo'; text: string };

export function inspireRequest(target: InspireTarget, topic: TopicChoice): InspireRequest {
  if (topic.kind === 'tag') return { source: target.source, tagId: topic.tagId };
  if (topic.kind === 'testo' && topic.text.trim()) {
    return { source: target.source, topic: topic.text.trim().slice(0, 80) };
  }
  return { source: target.source };
}

/** I numeri salvati del post, come righe brevi. */
export function signalLines(signals: InspirationSignals | null): string[] {
  if (!signals) return [];
  const lines = [
    signals.views !== null ? `${compactNumber(signals.views)} visualizzazioni` : null,
    signals.likes !== null ? `${compactNumber(signals.likes)} like` : null,
    signals.comments !== null ? `${compactNumber(signals.comments)} commenti` : null,
    signals.shares !== null ? `${compactNumber(signals.shares)} condivisioni` : null,
  ].filter((line): line is string => Boolean(line));
  if (signals.rate !== null && signals.basis) {
    const median =
      signals.medianRate !== null ? ` (mediana del profilo ${percent(signals.medianRate)})` : '';
    lines.push(`interazioni ${percent(signals.rate)} sui ${signals.basis}${median}`);
  }
  return lines;
}

/** Piattaforme proposte: quella del post d'origine se è anche del brand, altrimenti LinkedIn. */
export function initialPlatforms(target: InspireTarget): Platform[] {
  return [target.platform && PLATFORMS.includes(target.platform) ? target.platform : 'linkedin'];
}

/** L'idea da salvare, con il riferimento al post d'origine. */
export function inspiredIdeaInput(
  proposal: Inspiration,
  text: string,
  platforms: readonly Platform[],
): IdeaInput {
  return {
    text: text.trim() || inspirationIdeaText(proposal),
    source: 'suggerita',
    tagIds: proposal.idea.tagId ? [proposal.idea.tagId] : [],
    targetPlatforms: [...platforms],
    inspiration: proposal.inspiration,
  };
}
