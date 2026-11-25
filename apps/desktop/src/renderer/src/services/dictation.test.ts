import { describe, expect, it } from 'vitest';
import { appendDictation, dictationError, micTitle, pickAudioMime } from './dictation';

describe('dettatura', () => {
  it('aggiunge il testo dettato a quello scritto', () => {
    expect(appendDictation('', ' Un video su Rust ')).toBe('Un video su Rust');
    expect(appendDictation('Idea:  ', 'un video')).toBe('Idea: un video');
    expect(appendDictation('Idea', '   ')).toBe('Idea');
  });

  it('sceglie Opus in WebM se c’è', () => {
    expect(pickAudioMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickAudioMime((m) => m === 'audio/webm')).toBe('audio/webm');
    expect(pickAudioMime(() => false)).toBeUndefined();
  });

  it('spiega lo stato del pulsante', () => {
    expect(micTitle('pronto', false)).toContain('solo nell’app desktop');
    expect(micTitle('ascolto', true)).toBe('Ferma e trascrivi');
  });
});

describe('errori della dettatura', () => {
  it('toglie il prefisso di Electron', () => {
    expect(
      dictationError(
        new Error("Error invoking remote method 'dictation:transcribe': Error: Manca whisper"),
      ),
    ).toBe('Manca whisper');
    expect(dictationError('x')).toBe('Dettatura non riuscita');
  });
});
