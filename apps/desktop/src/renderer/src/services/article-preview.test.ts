// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  articleDate,
  articleText,
  parseArticle,
  readingMinutes,
  readingTimeLabel,
  safeHref,
} from './article-preview';

describe('parseArticle', () => {
  it('tiene i tag ammessi e trasforma h1 in h2', () => {
    expect(parseArticle('<h1>Titolo</h1><p>Ciao <strong>mondo</strong></p>')).toEqual([
      { kind: 'element', tag: 'h2', children: [{ kind: 'text', text: 'Titolo' }] },
      {
        kind: 'element',
        tag: 'p',
        children: [
          { kind: 'text', text: 'Ciao ' },
          { kind: 'element', tag: 'strong', children: [{ kind: 'text', text: 'mondo' }] },
        ],
      },
    ]);
  });

  it('scarta script, stili e iframe con il contenuto e scioglie gli altri tag', () => {
    const nodes = parseArticle(
      '<script>alert(1)</script><style>p{}</style><iframe src="x"></iframe>' +
        '<div onclick="x()"><span>resta</span></div><img src="x" onerror="alert(1)">',
    );
    expect(nodes).toEqual([{ kind: 'text', text: 'resta' }]);
  });

  it('ammette solo link web o email', () => {
    const [ok, bad] = parseArticle(
      '<a href="https://example.com/a">ok</a><a href="javascript:alert(1)">no</a>',
    );
    expect(ok).toMatchObject({ tag: 'a', href: 'https://example.com/a' });
    expect(bad).toMatchObject({ tag: 'a', href: undefined });
    expect(safeHref('data:text/html,x')).toBeUndefined();
    expect(safeHref('mailto:io@example.com')).toBe('mailto:io@example.com');
    expect(safeHref('/relativo')).toBeUndefined();
  });
});

describe('testo e tempo di lettura', () => {
  it('separa le parole di blocchi diversi', () => {
    expect(articleText(parseArticle('<h2>Uno</h2><p>due tre</p>'))).toBe('Uno due tre');
  });

  it('conta i minuti come il sito, almeno uno', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('parola '.repeat(200))).toBe(1);
    expect(readingMinutes('parola '.repeat(201))).toBe(2);
    expect(readingTimeLabel(1)).toBe('Lo leggi in 1 minuto');
    expect(readingTimeLabel(4)).toBe('Lo leggi in 4 minuti');
  });

  it('scrive la data in italiano nel fuso di Roma', () => {
    expect(articleDate(new Date('2026-11-21T23:30:00Z'))).toBe('22 novembre 2026');
  });
});
