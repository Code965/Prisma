import { describe, expect, it } from 'vitest';
import { releaseNotesText, shouldPrompt, updateErrorMessage } from './update-state.js';

describe('aggiornamenti', () => {
  it('trasforma le note HTML di GitHub in testo', () => {
    expect(
      releaseNotesText(
        '<h2>Novità</h2><ul><li>Elimina idee</li><li>Intro &amp; logo</li></ul><p>Grazie</p>',
      ),
    ).toBe('Novità\n\n• Elimina idee\n• Intro & logo\nGrazie');
    expect(releaseNotesText([{ version: '0.2.0', note: '<p>Una</p>' }])).toBe('0.2.0\nUna');
    expect(releaseNotesText(null)).toBeUndefined();
    expect(releaseNotesText('<p> </p>')).toBeUndefined();
  });

  it('mostra la finestra salvo per la versione saltata, sempre se richiesta a mano', () => {
    expect(shouldPrompt('0.2.0', null, false)).toBe(true);
    expect(shouldPrompt('0.2.0', '0.2.0', false)).toBe(false);
    expect(shouldPrompt('0.3.0', '0.2.0', false)).toBe(true);
    expect(shouldPrompt('0.2.0', '0.2.0', true)).toBe(true);
  });

  it('spiega gli errori di rete', () => {
    expect(updateErrorMessage(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(
      /non raggiungibile/,
    );
    expect(updateErrorMessage(new Error('HttpError: 404 Not Found\nbody'))).toMatch(
      /Nessuna release/,
    );
  });
});
