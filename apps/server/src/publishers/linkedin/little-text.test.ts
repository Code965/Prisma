import { describe, expect, it } from 'vitest';
import { buildCommentary, escapeLittleText, hashtagElement, visibleText } from './little-text.js';

describe('little text LinkedIn', () => {
  it('fa l’escape di tutti i caratteri riservati', () => {
    expect(escapeLittleText('a|b{c}@d[e](f)<g>#h\\i*j_k~l')).toBe(
      'a\\|b\\{c\\}\\@d\\[e\\]\\(f\\)\\<g\\>\\#h\\\\i\\*j\\_k\\~l',
    );
  });

  it('lascia invariato il testo normale, accenti e a capo compresi', () => {
    expect(escapeLittleText('Perché uso VB.NET?\nEcco 3 motivi.')).toBe(
      'Perché uso VB.NET?\nEcco 3 motivi.',
    );
  });

  it('scrive gli hashtag nel formato template', () => {
    expect(hashtagElement('#dotnet')).toBe('{hashtag|\\#|dotnet}');
    expect(buildCommentary('Testo (prova)', ['#dotnet', '#avalonia'])).toBe(
      'Testo \\(prova\\)\n\n{hashtag|\\#|dotnet} {hashtag|\\#|avalonia}',
    );
    expect(buildCommentary('  Solo testo  ', [])).toBe('Solo testo');
  });

  it('calcola il testo visibile per il controllo di lunghezza', () => {
    expect(visibleText('Ciao', ['#a', 'b'])).toBe('Ciao\n\n#a #b');
  });
});
