import { DEFAULT_RECOMMENDED_SLOTS, type PlanItem } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  bookedKey,
  formatDays,
  generatedPlanSchema,
  itemHour,
  monthDays,
  plannableDays,
  toPlan,
  weekdayOf,
  type PlanRequest,
} from './plan.js';
import { reviewPlan, type MonthPublication } from './review.js';

const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  days: plannableDays('2026-12', '2026-11-27'),
  platforms: ['linkedin'],
  slots: DEFAULT_RECOMMENDED_SLOTS,
  tags: [{ id: 7, brandId: 1, name: 'Rust' }],
  refs: {
    trends: [{ label: 'Rust 2.0', url: 'https://hn.example/1' }],
    competitors: [],
    ownPosts: [],
  },
  booked: new Set([bookedKey('2026-12-03', 'linkedin')]),
  data: 'Rust 2.0 con 340 punti',
  ...over,
});

const answer = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  summary: 'Un mese su Rust.',
  pillars: [
    { name: 'Rust in pratica', description: 'Esempi veri.', tag: 'Rust' },
    { name: 'Strumenti', description: 'Strumenti provati.', tag: null },
    { name: 'Carriera', description: 'Lavoro da sviluppatore.', tag: null },
  ],
  frequencies: [
    {
      platform: 'linkedin',
      perWeek: 2,
      formats: ['post', 'carosello'],
      slots: [{ weekday: 1, hour: 8 }],
      note: 'Due a settimana.',
    },
  ],
  items,
  ...extra,
});

const item = (day: number, over: Record<string, unknown> = {}) => ({
  day,
  platform: 'linkedin',
  format: 'post',
  pillar: 0,
  text: 'Rust in produzione',
  source: 'pilastro',
  ref: null,
  ...over,
});

describe('mesi e giorni', () => {
  it('giorni del mese, giorno della settimana e mesi successivi', () => {
    expect(monthDays('2027-02')).toHaveLength(28);
    expect(weekdayOf('2026-12-01')).toBe(1); // martedì
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(plannableDays('2026-11', '2026-11-28')).toEqual(['2026-11-29', '2026-11-30']);
    expect(formatDays(['2026-11-29', '2026-11-30']).split('\n')).toEqual(['- 29 dom', '- 30 lun']);
  });

  it("l'ora è lo slot scelto, poi quello consigliato dello stesso giorno", () => {
    expect(itemHour('2026-12-01', [{ weekday: 1, hour: 9 }], [{ weekday: 1, hour: 8 }])).toBe(9);
    expect(itemHour('2026-12-01', [], [{ weekday: 1, hour: 8 }])).toBe(8);
    expect(itemHour('2026-12-02', [], [{ weekday: 1, hour: 8 }])).toBeNull();
  });
});

describe('risposta del modello', () => {
  it('accetta un piano valido e lo converte con ore, pilastri e riferimenti', () => {
    const req = request();
    const parsed = generatedPlanSchema(req).parse(
      answer([item(1, { source: 'trend', ref: 0, format: 'carosello' }), item(2, { pillar: 1 })]),
    );
    const kept: PlanItem = {
      id: 'i0',
      day: '2026-12-03',
      hour: 8,
      platform: 'linkedin',
      format: 'post',
      pillar: 'Vecchio',
      text: 'Già creata',
      source: 'pilastro',
      reference: null,
      ideaId: 9,
    };
    const plan = toPlan(parsed, req, [kept]);
    expect(plan.pillars[0]).toEqual({
      name: 'Rust in pratica',
      description: 'Esempi veri.',
      tagId: 7,
    });
    expect(plan.items.map((i) => [i.id, i.day, i.hour, i.pillar])).toEqual([
      ['i1', '2026-12-01', 8, 'Rust in pratica'],
      ['i2', '2026-12-02', 8, 'Strumenti'],
      ['i0', '2026-12-03', 8, 'Vecchio'],
    ]);
    expect(plan.items[0]!.reference).toEqual({ label: 'Rust 2.0', url: 'https://hn.example/1' });
  });

  it('rifiuta giorni occupati, settimane troppo piene, riferimenti e numeri inventati', () => {
    const result = generatedPlanSchema(request()).safeParse(
      answer([
        item(3), // già occupato
        item(1, { source: 'trend', ref: 4 }), // riferimento inesistente
        item(2, { text: 'Rust ha 340 punti e 5000 stelle' }), // 5000 non viene dai dati
        item(4, { format: 'reel' }), // formato non scelto
        item(5), // terza della settimana 30 nov-6 dic
        item(40),
      ]),
    );
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/c'è già un'uscita/);
    expect(messages).toMatch(/elemento T esistente/);
    expect(messages).toMatch(/Numeri che non vengono dai dati: 5000/);
    expect(messages).toMatch(/Formato non tra quelli scelti/);
    expect(messages).toMatch(/Più di 2 uscite a settimana/);
    expect(messages).toMatch(/Il giorno 40/);
    expect(messages).not.toMatch(/340/);
  });

  it('vuole una frequenza per piattaforma, formati ammessi e orari consigliati', () => {
    const result = generatedPlanSchema(request({ platforms: ['linkedin', 'youtube'] })).safeParse(
      answer([item(1)], {
        frequencies: [
          {
            platform: 'linkedin',
            perWeek: 2,
            formats: ['reel'],
            slots: [{ weekday: 6, hour: 23 }],
            note: 'x',
          },
        ],
        pillars: [
          { name: 'A', description: 'a', tag: 'Go' },
          { name: 'B', description: 'b', tag: null },
          { name: 'C', description: 'c', tag: null },
        ],
      }),
    );
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/Serve una frequenza per youtube/);
    expect(messages).toMatch(/Formato "reel" non ammesso/);
    expect(messages).toMatch(/Orario non tra gli slot/);
    expect(messages).toMatch(/"Go" non è un argomento/);
  });
});

describe('revisione', () => {
  const items: PlanItem[] = ['01', '05', '10', '20'].map((d, i) => ({
    id: `i${i}`,
    day: `2026-12-${d}`,
    hour: 8,
    platform: 'linkedin',
    format: 'post',
    pillar: 'A',
    text: 't',
    source: 'pilastro',
    reference: null,
    ideaId: i === 3 ? null : i + 1,
  }));
  const plan = {
    month: '2026-12',
    items,
    frequencies: [
      {
        platform: 'linkedin' as const,
        perWeek: 2,
        formats: ['post' as const],
        slots: [],
        note: '',
      },
    ],
  };
  const pub = (over: Partial<MonthPublication>): MonthPublication => ({
    id: 1,
    ideaId: 1,
    platform: 'linkedin',
    day: '2026-12-01',
    status: 'pubblicato',
    url: 'https://li/1',
    interactions: 40,
    ...over,
  });

  it('nessuna revisione prima che il mese inizi', () => {
    expect(
      reviewPlan(plan, { ideas: new Set(), variants: new Map(), publications: [] }, '2026-11-30'),
    ).toBeNull();
  });

  it('avanzamento per idea, ritardi, obiettivo e uscite fuori dal piano', () => {
    const review = reviewPlan(
      plan,
      {
        ideas: new Set([1, 2]), // l'idea 3 è stata cancellata
        variants: new Map([[2, [{ platform: 'linkedin', status: 'bozza' }]]]),
        publications: [
          pub({}),
          pub({ id: 2, ideaId: null, day: '2026-12-08', interactions: 20 }),
          pub({
            id: 3,
            ideaId: null,
            day: '2026-12-09',
            status: 'programmato',
            interactions: null,
          }),
        ],
      },
      '2026-12-12',
    )!;
    expect(review.items.map((i) => [i.itemId, i.progress, i.late])).toEqual([
      ['i0', 'pubblicato', false],
      ['i1', 'bozza', true],
      ['i2', 'da_creare', true],
      ['i3', 'da_creare', false],
    ]);
    expect(review.items[0]).toMatchObject({
      publicationId: 1,
      url: 'https://li/1',
      interactions: 40,
    });
    expect(review.totals).toEqual({
      items: 4,
      ideas: 2,
      drafts: 1,
      scheduled: 0,
      published: 1,
      late: 2,
    });
    expect(review.platforms).toEqual([
      {
        platform: 'linkedin',
        planned: 4,
        target: 9,
        published: 2,
        scheduled: 1,
        medianInteractions: 30,
      },
    ]);
    expect(review.outsidePlan).toBe(2);
    expect(review.until).toBe('2026-12-12');
    expect(review.elapsed).toBeCloseTo(12 / 31);
  });
});
