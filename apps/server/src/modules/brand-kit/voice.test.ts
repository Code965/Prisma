import type { VoiceExample } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { VOICE_PROMPT_EXAMPLES, formatVoice } from './voice.js';

const example = (id: number, text: string, note = ''): VoiceExample => ({
  id,
  brandId: 1,
  platform: 'linkedin',
  text,
  note,
  createdAt: '2026-11-22T08:00:00.000Z',
});

describe('formatVoice', () => {
  it('senza regole né esempi restituisce una frase neutra', () => {
    expect(formatVoice([], [])).toMatch(/Nessuna indicazione/);
  });

  it('elenca regole ed esempi con piattaforma e nota', () => {
    const text = formatVoice(
      ['Frasi brevi', 'Niente emoji'],
      [example(1, 'Ho passato 3 mesi…', 'apertura')],
    );
    expect(text).toContain('- Frasi brevi\n- Niente emoji');
    expect(text).toContain('[LinkedIn (apertura)]\n"""\nHo passato 3 mesi…\n"""');
  });

  it('limita numero e lunghezza degli esempi', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      example(i, `esempio ${i} ${'x'.repeat(2000)}`),
    );
    const text = formatVoice([], many);
    expect(text.match(/\[LinkedIn\]/g)).toHaveLength(VOICE_PROMPT_EXAMPLES);
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(VOICE_PROMPT_EXAMPLES * 1300);
  });
});
