import { z } from 'zod';
import { PlatformSchema } from '../domain/platforms.js';
import { IdSchema } from './common.js';
import { ENGAGEMENT_BASES } from './competitors.js';

/**
 * «Ispirati» (fase 8c): dal post di un concorrente, da un trend o da un testo incollato l'AI spiega
 * il meccanismo (apertura, struttura, perché ha funzionato) e propone un'idea sul proprio
 * argomento. Si riusa la forma, mai il testo: il server rifiuta le proposte che copiano frasi.
 */

const HttpUrlSchema = z.url({ protocol: /^https?$/, error: 'Indirizzo http o https' }).max(500);

/** Da dove nasce l'ispirazione. */
export const InspireSourceSchema = z.discriminatedUnion('kind', [
  /** Un post salvato nella schermata Concorrenti. */
  z.object({ kind: z.literal('concorrente'), postId: IdSchema }),
  /** Un post o un link incollato a mano, o un contenuto del radar dei trend. */
  z.object({
    kind: z.literal('testo'),
    text: z.string().trim().min(1).max(3000),
    title: z.string().trim().max(200).nullish(),
    url: HttpUrlSchema.nullish(),
    platform: PlatformSchema.nullish(),
    /** Chi l'ha scritto o da dove viene («Hacker News», il nome di un profilo…). */
    label: z.string().trim().max(80).nullish(),
  }),
]);
export type InspireSource = z.infer<typeof InspireSourceSchema>;

export const InspireRequestSchema = z.object({
  source: InspireSourceSchema,
  /** Argomento scelto tra i tag del brand… */
  tagId: IdSchema.nullish(),
  /** …o scritto dall'utente. Senza nessuno dei due l'AI sceglie tra i tag del brand. */
  topic: z.string().trim().min(1).max(80).nullish(),
});
export type InspireRequest = z.infer<typeof InspireRequestSchema>;

/** Riferimento al post d'origine, salvato sull'idea. */
export const IdeaInspirationSchema = z.object({
  kind: z.enum(['concorrente', 'testo']),
  competitorPostId: IdSchema.nullable(),
  label: z.string().max(80),
  platform: PlatformSchema.nullable(),
  title: z.string().max(200),
  url: HttpUrlSchema.nullable(),
});
export type IdeaInspiration = z.infer<typeof IdeaInspirationSchema>;

const count = z.int().nonnegative().nullable();

/** Numeri del post d'origine, solo quelli salvati (null = non noto). */
export const InspirationSignalsSchema = z.object({
  views: count,
  likes: count,
  comments: count,
  shares: count,
  basis: z.enum(ENGAGEMENT_BASES).nullable(),
  /** Tasso di interazione del post e mediana del profilo, sulla stessa base. */
  rate: z.number().nonnegative().nullable(),
  medianRate: z.number().nonnegative().nullable(),
});
export type InspirationSignals = z.infer<typeof InspirationSignalsSchema>;

export const InspirationMechanismSchema = z.object({
  /** Tipo di apertura (descritto, non citato). */
  hook: z.string(),
  /** Le parti del post nell'ordine. */
  structure: z.array(z.string()),
  whyItWorked: z.string(),
});
export type InspirationMechanism = z.infer<typeof InspirationMechanismSchema>;

export const InspirationSchema = z.object({
  inspiration: IdeaInspirationSchema,
  signals: InspirationSignalsSchema.nullable(),
  mechanism: InspirationMechanismSchema,
  idea: z.object({
    topic: z.string(),
    /** Tag del brand corrispondente all'argomento, se c'è. */
    tagId: IdSchema.nullable(),
    text: z.string(),
    /** Apertura proposta, con parole proprie. */
    hook: z.string(),
  }),
  model: z.string(),
});
export type Inspiration = z.infer<typeof InspirationSchema>;

/** Testo dell'idea da salvare: la proposta più la forma da riusare, così le bozze la seguono. */
export function inspirationIdeaText(proposal: Pick<Inspiration, 'mechanism' | 'idea'>): string {
  const steps = proposal.mechanism.structure.map((step, i) => `${i + 1}. ${step}`).join('\n');
  return [
    proposal.idea.text,
    `Apertura: ${proposal.idea.hook}`,
    `Struttura da seguire:\n${steps}`,
  ].join('\n\n');
}
