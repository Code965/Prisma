import { describe, expect, it } from 'vitest';
import {
  copiedPhrase,
  inspirationSchema,
  inventedNumbers,
  type InspirationInput,
} from './inspire.js';

const source: InspirationInput = {
  inspiration: {
    kind: 'concorrente',
    competitorPostId: 1,
    label: 'Marta',
    platform: 'linkedin',
    title: 'Tre errori',
    url: 'https://www.linkedin.com/posts/marta-1',
  },
  text: 'Tre errori che faccio ancora con TypeScript dopo cinque anni di lavoro. Il primo: any ovunque.',
  format: 'carosello',
  signals: {
    views: null,
    likes: 120,
    comments: 30,
    shares: null,
    basis: 'follower',
    rate: 0.03,
    medianRate: 0.02,
  },
};

const valid = {
  mechanism: {
    hook: 'Confessione di errori ricorrenti, in prima persona',
    structure: ['Gli errori in un elenco numerato', 'Una domanda finale'],
    whyItWorked: 'Chi legge si riconosce negli errori. Ha reso più della mediana del profilo.',
  },
  idea: {
    topic: 'Docker',
    text: 'Racconta gli sbagli che facevi scrivendo i Dockerfile e come li hai corretti.',
    hook: 'Ho spedito in produzione immagini enormi per mesi.',
  },
};

describe('copiedPhrase', () => {
  it('trova sei parole di fila uguali, ignorando maiuscole, accenti e punteggiatura', () => {
    expect(copiedPhrase('Ecco: tre ERRORI che faccio ancora con Go', source.text)).toBe(
      'tre errori che faccio ancora con',
    );
    expect(copiedPhrase('Tre errori che faccio con Go', source.text)).toBeNull();
  });
});

describe('inventedNumbers', () => {
  it('ammette i numeri dei dati e quelli piccoli', () => {
    const allowed = new Set(['120', '30']);
    expect(
      inventedNumbers('120 like, 3 passi, 4.500 visualizzazioni e 30 commenti', allowed),
    ).toEqual(['4500']);
  });
});

describe('inspirationSchema', () => {
  it('accetta una proposta che riusa solo la forma', () => {
    expect(inspirationSchema(source, ['Docker', 'Rust']).safeParse(valid).success).toBe(true);
  });

  it('rifiuta frasi copiate, numeri inventati e argomenti non ammessi', () => {
    const result = inspirationSchema(source, ['Rust']).safeParse({
      mechanism: { ...valid.mechanism, whyItWorked: 'Ha avuto 900 like.' },
      idea: { ...valid.idea, hook: 'Tre errori che faccio ancora con TypeScript' },
    });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/Frase copiata/);
    expect(messages).toMatch(/Numeri non presenti nei dati \(900\)/);
    expect(messages).toMatch(/L'argomento deve essere uno di: Rust/);
  });
});
