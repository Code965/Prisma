import { describe, expect, it } from 'vitest';
import { articleText, sanitizeArticleHtml, wordCount } from './article-html.js';

describe('HTML degli articoli', () => {
  it('mantiene struttura, formattazione, link e codice', () => {
    const html =
      '<h2>Perché</h2><p>Uso <strong>VB.NET</strong> e <a href="https://example.test">questo</a>.</p><pre><code>Dim x = 1</code></pre>';
    expect(sanitizeArticleHtml(html)).toBe(
      '<h2>Perché</h2><p>Uso <strong>VB.NET</strong> e <a href="https://example.test" rel="noopener noreferrer">questo</a>.</p><pre><code>Dim x = 1</code></pre>',
    );
  });

  it('toglie script, stili, eventi e link pericolosi', () => {
    const html =
      '<p onclick="x()" style="color:red">Testo<script>alert(1)</script></p><a href="javascript:alert(1)">x</a><iframe src="https://e.test"></iframe>';
    expect(sanitizeArticleHtml(html)).toBe('<p>Testo</p><a rel="noopener noreferrer">x</a>');
  });

  it('trasforma gli h1 in h2 perché il titolo è un campo a parte', () => {
    expect(sanitizeArticleHtml('<h1>Titolo</h1>')).toBe('<h2>Titolo</h2>');
  });

  it('conta le parole del testo visibile', () => {
    expect(articleText('<h2>Uno</h2><p>due  tre</p>')).toBe('Uno due tre');
    expect(wordCount('<p>uno due tre quattro</p>')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});
