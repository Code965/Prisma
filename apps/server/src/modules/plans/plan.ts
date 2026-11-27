import {
  PLAN_ITEMS_MAX,
  PLAN_PILLARS_MAX,
  PLAN_PILLARS_MIN,
  PLAN_SOURCES,
  PLATFORM_FORMATS,
  PLATFORM_LABELS,
  type Platform,
  type PlanFrequency,
  type PlanItem,
  type PlanPillar,
  type PlanReference,
  type Slot,
  type Tag,
  type VariantFormat,
} from '@prisma-app/shared';
import { z } from 'zod';
import { inventedNumbers, numbersIn } from '../ai/inspire.js';
import { addDays } from '../analytics/aggregate.js';

export const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

// --- Mesi e giorni (calendario italiano, giorni `AAAA-MM-GG`) --------------------------------

export function monthDays(month: string): string[] {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** 0 = lunedì. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Lunedì della settimana del giorno: chiave per contare le uscite per settimana. */
export const weekOf = (day: string) => addDays(day, -weekdayOf(day));

export function addMonths(month: string, months: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(year, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Giorni pianificabili: dal giorno dopo oggi (se il mese è in corso) all'ultimo. */
export function plannableDays(month: string, today: string): string[] {
  return monthDays(month).filter((day) => day > today);
}

const slotLabel = (slot: Slot) =>
  `${WEEKDAYS[slot.weekday]} ${String(slot.hour).padStart(2, '0')}:00`;

// --- Richiesta al modello --------------------------------------------------------------------

/** Ciò a cui un'idea del piano può rimandare: numerati nel prompt (T0, C0, P0). */
export interface PlanRefs {
  trends: PlanReference[];
  competitors: PlanReference[];
  ownPosts: PlanReference[];
}

export interface PlanRequest {
  days: readonly string[];
  platforms: readonly Platform[];
  /** Slot consigliati per piattaforma (dai dati o predefiniti). */
  slots: Readonly<Record<Platform, readonly Slot[]>>;
  tags: readonly Tag[];
  refs: PlanRefs;
  /** `giorno|piattaforma` già occupati da uscite programmate o da idee già messe in calendario. */
  booked: ReadonlySet<string>;
  /** Testo dei dati mandati al modello: i numeri ammessi nelle risposte vengono da qui. */
  data: string;
}

export const bookedKey = (day: string, platform: Platform) => `${day}|${platform}`;

export function formatDays(days: readonly string[]): string {
  const weeks = new Map<string, string[]>();
  for (const day of days) {
    const key = weekOf(day);
    weeks.set(key, [
      ...(weeks.get(key) ?? []),
      `${Number(day.slice(8))} ${WEEKDAYS[weekdayOf(day)]}`,
    ]);
  }
  return [...weeks.values()].map((list) => `- ${list.join(', ')}`).join('\n');
}

export function formatSlots(
  platforms: readonly Platform[],
  slots: PlanRequest['slots'],
  sources: Partial<Record<Platform, string>>,
): string {
  return platforms
    .map((p) => {
      const list = slots[p].map(slotLabel).join(', ') || 'nessuno';
      return `${PLATFORM_LABELS[p]}: ${list}${sources[p] ? ` (${sources[p]})` : ''}`;
    })
    .join('\n');
}

/** Righe numerate (`[T0]`, `[C0]`, `[P0]`) che il modello cita con `ref`. */
export function formatRefs(prefix: string, lines: readonly string[]): string {
  return lines.length === 0
    ? 'nessuno'
    : lines.map((line, i) => `[${prefix}${i}] ${line}`).join('\n');
}

const REF_PREFIX = { trend: 'T', concorrente: 'C', tuo_post: 'P' } as const;
const refList = (refs: PlanRefs, source: keyof typeof REF_PREFIX) =>
  source === 'trend' ? refs.trends : source === 'concorrente' ? refs.competitors : refs.ownPosts;

/**
 * Risposta del modello, controllata sulla richiesta: piattaforme e formati ammessi, orari tra gli
 * slot consigliati, giorni liberi del mese, al massimo `perWeek` uscite per settimana, riferimenti
 * esistenti e nessun numero che non venga dai dati. Gli errori tornano al modello.
 */
export function generatedPlanSchema(request: PlanRequest) {
  const text = (max: number) => z.string().trim().min(1).max(max);
  const tagNames = new Set(request.tags.map((t) => t.name));
  const dayNumbers = new Map(request.days.map((day) => [Number(day.slice(8)), day]));
  const allowedNumbers = new Set(numbersIn(request.data));
  const platform = z.enum(request.platforms as [Platform, ...Platform[]]);

  return z
    .object({
      summary: text(400),
      pillars: z
        .array(
          z.object({
            name: text(40),
            description: text(200),
            tag: z.string().trim().nullable().default(null),
          }),
        )
        .min(PLAN_PILLARS_MIN)
        .max(PLAN_PILLARS_MAX),
      frequencies: z.array(
        z.object({
          platform,
          perWeek: z.int().min(1).max(7),
          formats: z.array(z.string()).min(1).max(3),
          slots: z
            .array(z.object({ weekday: z.int().min(0).max(6), hour: z.int().min(0).max(23) }))
            .max(7)
            .default([]),
          note: text(200),
        }),
      ),
      items: z
        .array(
          z.object({
            day: z.int(),
            platform,
            format: z.string(),
            pillar: z.int().min(0),
            text: text(400),
            source: z.enum(PLAN_SOURCES),
            ref: z.int().min(0).nullable().default(null),
          }),
        )
        .min(1)
        .max(PLAN_ITEMS_MAX),
    })
    .superRefine((plan, ctx) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: 'custom', path, message });

      const names = plan.pillars.map((p) => p.name.toLowerCase());
      if (new Set(names).size !== names.length) issue(['pillars'], 'Pilastri con lo stesso nome');
      plan.pillars.forEach((p, i) => {
        if (p.tag !== null && !tagNames.has(p.tag)) {
          issue(
            ['pillars', i, 'tag'],
            `"${p.tag}" non è un argomento del brand: usa l'elenco o null`,
          );
        }
      });

      const byPlatform = new Map(plan.frequencies.map((f) => [f.platform, f]));
      for (const p of request.platforms) {
        const count = plan.frequencies.filter((f) => f.platform === p).length;
        if (count !== 1) issue(['frequencies'], `Serve una frequenza per ${p} (ora ${count})`);
      }
      plan.frequencies.forEach((f, i) => {
        f.formats.forEach((format, j) => {
          if (!PLATFORM_FORMATS[f.platform].includes(format as VariantFormat)) {
            issue(
              ['frequencies', i, 'formats', j],
              `Formato "${format}" non ammesso su ${f.platform}: ${PLATFORM_FORMATS[f.platform].join(', ')}`,
            );
          }
        });
        const recommended = request.slots[f.platform];
        f.slots.forEach((s, j) => {
          if (!recommended.some((r) => r.weekday === s.weekday && r.hour === s.hour)) {
            issue(
              ['frequencies', i, 'slots', j],
              `Orario non tra gli slot consigliati di ${f.platform}`,
            );
          }
        });
      });

      const seen = new Set<string>();
      const perWeek = new Map<string, number>();
      plan.items.forEach((item, i) => {
        const day = dayNumbers.get(item.day);
        if (!day) {
          issue(['items', i, 'day'], `Il giorno ${item.day} non è tra i giorni liberi del mese`);
          return;
        }
        const frequency = byPlatform.get(item.platform);
        if (frequency && !frequency.formats.includes(item.format)) {
          issue(['items', i, 'format'], `Formato non tra quelli scelti per ${item.platform}`);
        }
        if (item.pillar >= plan.pillars.length)
          issue(['items', i, 'pillar'], 'Pilastro inesistente');
        if (item.source === 'pilastro') {
          if (item.ref !== null) issue(['items', i, 'ref'], 'Con la fonte "pilastro" ref è null');
        } else {
          const list = refList(request.refs, item.source);
          if (item.ref === null || item.ref >= list.length) {
            issue(
              ['items', i, 'ref'],
              `Con la fonte "${item.source}" ref è il numero di un elemento ${REF_PREFIX[item.source]} esistente`,
            );
          }
        }
        const key = bookedKey(day, item.platform);
        if (request.booked.has(key))
          issue(['items', i], `Il ${item.day} su ${item.platform} c'è già un'uscita`);
        if (seen.has(key)) issue(['items', i], `Due idee lo stesso giorno su ${item.platform}`);
        seen.add(key);
        const week = `${item.platform}|${weekOf(day)}`;
        perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
        if (frequency && perWeek.get(week)! > frequency.perWeek) {
          issue(['items', i], `Più di ${frequency.perWeek} uscite a settimana su ${item.platform}`);
        }
      });

      const texts: [(string | number)[], string][] = [
        [['summary'], plan.summary],
        ...plan.pillars.map((p, i): [(string | number)[], string] => [
          ['pillars', i],
          p.description,
        ]),
        ...plan.frequencies.map((f, i): [(string | number)[], string] => [
          ['frequencies', i, 'note'],
          f.note,
        ]),
        ...plan.items.map((it, i): [(string | number)[], string] => [
          ['items', i, 'text'],
          it.text,
        ]),
      ];
      for (const [path, value] of texts) {
        const invented = inventedNumbers(value, allowedNumbers);
        if (invented.length > 0) {
          issue(path, `Numeri che non vengono dai dati: ${invented.join(', ')}. Toglili`);
        }
      }
    });
}

export type GeneratedPlan = z.infer<ReturnType<typeof generatedPlanSchema>>;

/** Ora dell'uscita: lo slot scelto (o consigliato) in quel giorno della settimana. */
export function itemHour(day: string, chosen: readonly Slot[], recommended: readonly Slot[]) {
  const weekday = weekdayOf(day);
  return (
    chosen.find((s) => s.weekday === weekday)?.hour ??
    recommended.find((s) => s.weekday === weekday)?.hour ??
    null
  );
}

/** Dalla risposta al piano salvato; `kept` sono le idee del piano precedente già create. */
export function toPlan(
  generated: GeneratedPlan,
  request: PlanRequest,
  kept: readonly PlanItem[] = [],
): { summary: string; pillars: PlanPillar[]; frequencies: PlanFrequency[]; items: PlanItem[] } {
  const tagByName = new Map(request.tags.map((t) => [t.name, t.id]));
  const pillars = generated.pillars.map((p) => ({
    name: p.name,
    description: p.description,
    tagId: p.tag !== null ? (tagByName.get(p.tag) ?? null) : null,
  }));
  const frequencies = request.platforms.map((platform) => {
    const f = generated.frequencies.find((x) => x.platform === platform)!;
    return {
      platform,
      perWeek: f.perWeek,
      formats: [...new Set(f.formats)] as VariantFormat[],
      slots: f.slots,
      note: f.note,
    };
  });
  const byPlatform = new Map(frequencies.map((f) => [f.platform, f]));
  const used = new Set(kept.map((k) => k.id));
  let next = 0;
  const nextId = () => {
    while (used.has(`i${next}`)) next++;
    used.add(`i${next}`);
    return `i${next}`;
  };
  const dayOf = new Map(request.days.map((day) => [Number(day.slice(8)), day]));
  const created: PlanItem[] = generated.items.map((item) => {
    const day = dayOf.get(item.day)!;
    return {
      id: nextId(),
      day,
      hour: itemHour(day, byPlatform.get(item.platform)?.slots ?? [], request.slots[item.platform]),
      platform: item.platform,
      format: item.format as VariantFormat,
      pillar: pillars[item.pillar]!.name,
      text: item.text,
      source: item.source,
      reference:
        item.source === 'pilastro' || item.ref === null
          ? null
          : refList(request.refs, item.source)[item.ref]!,
      ideaId: null,
    };
  });
  const items = [...kept, ...created].sort(
    (a, b) => a.day.localeCompare(b.day) || a.platform.localeCompare(b.platform),
  );
  return { summary: generated.summary, pillars, frequencies, items };
}

/** Testo dell'idea creata dal piano: l'idea, poi formato e pilastro per lo Studio. */
export function planIdeaText(item: PlanItem): string {
  const lines = [item.text, '', `Formato: ${item.format} · Pilastro: ${item.pillar}`];
  if (item.reference) {
    lines.push(
      `Spunto: ${item.reference.label}${item.reference.url ? ` (${item.reference.url})` : ''}`,
    );
  }
  return lines.join('\n');
}
