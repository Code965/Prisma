import type { ChatMessage, Variant, VariantRevision } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { changedLines, diffLines } from './diff';
import {
  approvalSteps,
  charCount,
  chatItems,
  formatCount,
  headline,
  isDirty,
  normalizeHashtag,
  previewText,
  sortVariants,
} from './studio';

describe('diff riga per riga', () => {
  it('trova righe rimosse, aggiunte e invariate', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('mostra solo le righe cambiate e non vuote', () => {
    const before = 'Negli ultimi tre mesi ho lavorato a…\n\nFine';
    const after = 'Ho passato 3 mesi a costruire un client database.\n\nFine';
    expect(changedLines(before, after)).toEqual([
      { kind: 'del', text: 'Negli ultimi tre mesi ho lavorato a…' },
      { kind: 'add', text: 'Ho passato 3 mesi a costruire un client database.' },
    ]);
  });
});

describe('approvazione', () => {
  it('da bozza salva (se serve), invia in revisione e approva', () => {
    expect(approvalSteps('bozza', false)).toEqual(['submit', 'approve']);
    expect(approvalSteps('bozza', true)).toEqual(['save', 'submit', 'approve']);
    expect(approvalSteps('da_approvare', false)).toEqual(['approve']);
  });

  it('una modifica a una variant approvata richiede di riapprovarla', () => {
    expect(approvalSteps('approvato', false)).toEqual([]);
    expect(approvalSteps('approvato', true)).toEqual(['save', 'submit', 'approve']);
  });

  it('non approva dalla coda o da un errore senza modifiche', () => {
    expect(approvalSteps('programmato', false)).toEqual([]);
    expect(approvalSteps('programmato', true)).toEqual([]);
    expect(approvalSteps('errore', false)).toEqual([]);
  });
});

describe('campi e anteprime', () => {
  it('conta i caratteri visibili e li formatta all’italiana', () => {
    expect(charCount('perché 🚀')).toBe(8);
    expect(formatCount(642, 3000)).toBe('642 / 3.000');
  });

  it('tronca come nei feed', () => {
    expect(previewText('breve', 10)).toEqual({ text: 'breve', truncated: false });
    expect(previewText('una frase lunga', 9)).toEqual({ text: 'una frase', truncated: true });
  });

  it('usa il titolo o la prima riga come titolo grande', () => {
    expect(headline({ body: '\nPrima riga\nAltro', metadata: { hashtags: [] } })).toBe(
      'Prima riga',
    );
    expect(headline({ body: 'x', metadata: { hashtags: [], title: 'Titolo' } })).toBe('Titolo');
  });

  it('riconosce le modifiche non salvate', () => {
    const saved = { body: 'a', metadata: { hashtags: ['#x'] } };
    expect(isDirty({ ...saved }, saved)).toBe(false);
    expect(isDirty({ ...saved, body: 'b' }, saved)).toBe(true);
    expect(isDirty({ ...saved, metadata: { hashtags: [] } }, saved)).toBe(true);
  });

  it('normalizza gli hashtag scritti a mano', () => {
    expect(normalizeHashtag('  #dotnet ')).toBe('#dotnet');
    expect(normalizeHashtag('clean code')).toBe('#cleancode');
    expect(normalizeHashtag('c#')).toBeNull();
  });

  it('ordina le tab come le piattaforme', () => {
    const v = (platform: Variant['platform']) => ({ platform }) as Variant;
    expect(sortVariants([v('youtube'), v('linkedin')]).map((x) => x.platform)).toEqual([
      'linkedin',
      'youtube',
    ]);
  });
});

describe('chat dello Studio', () => {
  const revision = (id: number, body: string, at: string): VariantRevision => ({
    id,
    variantId: 7,
    body,
    metadata: { hashtags: [] },
    source: id === 1 ? 'llm_generate' : 'llm_edit',
    instruction: null,
    createdAt: at,
  });
  const message = (
    id: number,
    role: 'user' | 'assistant',
    revisionId: number | null,
    variantId = 7,
  ) =>
    ({
      id,
      contentId: 1,
      variantId,
      role,
      text: `m${id}`,
      revisionId,
      createdAt: '',
    }) as ChatMessage;

  it('ricostruisce il diff di ogni modifica e la revisione a cui tornare', () => {
    const revisions = [
      revision(2, 'Testo corto', '2026-11-21T10:05:00.000Z'),
      revision(1, 'Testo lungo e prolisso', '2026-11-21T10:00:00.000Z'),
    ];
    const items = chatItems(
      [message(10, 'user', null), message(11, 'assistant', 2), message(12, 'user', null, 8)],
      revisions,
      7,
    );
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      role: 'assistant',
      undoRevisionId: 1,
      isCurrent: true,
      diff: [
        { kind: 'del', text: 'Testo lungo e prolisso' },
        { kind: 'add', text: 'Testo corto' },
      ],
    });
  });

  it('non propone di annullare una modifica già superata', () => {
    const revisions = [
      revision(1, 'Originale', '2026-11-21T10:00:00.000Z'),
      revision(2, 'Modificato', '2026-11-21T10:05:00.000Z'),
      revision(3, 'Originale', '2026-11-21T10:06:00.000Z'), // ripristino
    ];
    const [, assistant] = chatItems(
      [message(10, 'user', null), message(11, 'assistant', 2)],
      revisions,
      7,
    );
    expect(assistant!.isCurrent).toBe(false);
  });
});
