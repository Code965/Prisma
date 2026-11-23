import { INSIGHT_KIND_LABELS, type InsightsState, type InsightTip } from '@prisma-app/shared';
import { UI_TIME_ZONE } from './dates';

export interface InsightCard {
  kind: InsightTip['kind'];
  label: string;
  text: string;
  why: string;
  /** Azione del mockup: crea un'idea dal suggerimento o apre una schermata. */
  action:
    { kind: 'idea'; label: string; idea: string } | { kind: 'link'; label: string; to: string };
}

const LINKS = {
  orari: { label: 'Apri il calendario', to: '/calendario' },
  formati: { label: 'Apri editor video', to: '/video' },
  argomenti: { label: 'Apri le idee', to: '/idee' },
} as const;

export function insightCards(state: InsightsState | undefined): InsightCard[] {
  return (state?.insights?.tips ?? []).map((tip) => ({
    kind: tip.kind,
    label: INSIGHT_KIND_LABELS[tip.kind],
    text: tip.text,
    why: tip.why,
    action:
      tip.kind === 'argomenti' && tip.idea
        ? { kind: 'idea', label: 'Crea un’idea su questo', idea: tip.idea }
        : { kind: 'link', ...LINKS[tip.kind] },
  }));
}

/** «DeepSeek · aggiornati lunedì 23 nov», o perché non ci sono ancora. */
export function insightsSubtitle(state: InsightsState | undefined): string {
  const insights = state?.insights;
  if (!insights) return 'Ogni lunedì, dalle metriche';
  const provider = insights.model.split(':')[0] ?? insights.model;
  const name = provider === 'deepseek' ? 'DeepSeek' : provider;
  const date = new Intl.DateTimeFormat('it-IT', {
    timeZone: UI_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(insights.createdAt))
    .replace('.', '');
  return `${name} · aggiornati ${date}`;
}
