import {
  BUILTIN_TEMPLATE_STYLES,
  CarouselSchema,
  DEFAULT_BRAND_KIT,
  type Carousel,
} from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { mixHex } from './colors.js';
import { templatePalette } from './palette.js';
import { renderCarouselPdfHtml, renderInputKey, renderSlideHtml } from './slide.js';

const carousel: Carousel = CarouselSchema.parse({
  template: 'scuro',
  kicker: 'client-db',
  slides: [
    { kind: 'cover', title: 'Ho costruito un client database da zero', body: '3 cose che rifarei' },
    { kind: 'list', title: 'Lo stack', body: 'C# e .NET\n\nAvalonia per la UI' },
    { kind: 'code', title: 'Il bug', body: 'Thread sbagliato.', code: 'if (a < b && c) {}' },
    { kind: 'cta', title: 'Video su YouTube', body: 'Link nel profilo.' },
  ],
});

const render = (index: number, patch: Partial<Carousel> = {}, kit = DEFAULT_BRAND_KIT) =>
  renderSlideHtml({ carousel: { ...carousel, ...patch }, index, kit, initials: 'MR' });

describe('colori', () => {
  it('mescola due colori', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('#101318', '#FFFFFF', 1)).toBe('#101318');
    expect(() => mixHex('red', '#FFFFFF', 0.5)).toThrow(/non valido/);
  });

  it('con il kit predefinito i template usano i colori del mockup', () => {
    const scuro = templatePalette('scuro', DEFAULT_BRAND_KIT.colors);
    expect(scuro).toMatchObject({ bg: '#101318', accent: '#A5B4FC' });
    expect(templatePalette('chiaro', DEFAULT_BRAND_KIT.colors)).toMatchObject({
      bg: '#FFFFFF',
      fg: '#101318',
      accent: '#4F46E5',
    });
    expect(templatePalette('codice', DEFAULT_BRAND_KIT.colors).accent).toBe('#5EEAD4');
  });
});

describe('renderSlideHtml', () => {
  it('disegna la copertina 1080×1350 con kicker, piede e numerazione', () => {
    const html = render(0);
    expect(html).toContain('width:1080px;height:1350px');
    expect(html).toContain('<span class="kicker">// client-db</span>');
    expect(html).toContain('class="content cover"');
    expect(html).toContain('<span class="mark">MR</span>');
    expect(html).toContain('<span class="count">1 / 4</span>');
    expect(html).not.toContain('class="handle"');
    expect(html).not.toMatch(/<script/i);
  });

  it('numera i punti dell’elenco ignorando le righe vuote', () => {
    const html = render(1);
    expect(html).toContain('<span class="num">01</span><span>C# e .NET</span>');
    expect(html).toContain('<span class="num">02</span><span>Avalonia per la UI</span>');
    expect(html).not.toContain('<span class="num">03</span>');
  });

  it('esegue l’escape di testo e codice', () => {
    const html = render(2);
    expect(html).toContain('<pre class="code">if (a &lt; b &amp;&amp; c) {}</pre>');
    const evil = render(0, {
      slides: [{ kind: 'cover', title: '<script>alert(1)</script>', body: '', code: '' }],
    });
    expect(evil).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(evil).not.toContain('<script>');
  });

  it('usa logo, handle e il prompt del terminale quando ci sono', () => {
    const kit = { ...DEFAULT_BRAND_KIT, handle: 'marta', logo: 'data:image/png;base64,AA==' };
    const html = render(3, { template: 'codice' }, kit);
    expect(html).toContain('<span class="kicker">$ cat client-db</span>');
    expect(html).toContain('<img src="data:image/png;base64,AA==" alt="">');
    expect(html).toContain('<span class="handle">@marta</span>');
    expect(html).toContain('<span class="arrow">→</span>');
  });

  it('segnala una slide inesistente', () => {
    expect(() => render(9)).toThrow(RangeError);
  });
});

describe('PDF e chiave di rendering', () => {
  it('mette tutte le slide in pagine 1080×1350', () => {
    const html = renderCarouselPdfHtml({ carousel, kit: DEFAULT_BRAND_KIT, initials: 'MR' });
    expect(html.match(/<main class="slide">/g)).toHaveLength(4);
    expect(html).toContain('@page{size:1080px 1350px;margin:0}');
    expect(html).toContain('<span class="count">4 / 4</span>');
  });

  it('cambia solo se cambia l’aspetto delle slide', () => {
    const key = renderInputKey(carousel, DEFAULT_BRAND_KIT, 'MR');
    expect(renderInputKey(structuredClone(carousel), { ...DEFAULT_BRAND_KIT }, 'MR')).toBe(key);
    expect(renderInputKey({ ...carousel, template: 'chiaro' }, DEFAULT_BRAND_KIT, 'MR')).not.toBe(
      key,
    );
    expect(renderInputKey(carousel, { ...DEFAULT_BRAND_KIT, handle: 'x' }, 'MR')).not.toBe(key);
    const sora = {
      ...DEFAULT_BRAND_KIT,
      fonts: { ...DEFAULT_BRAND_KIT.fonts, heading: 'sora' as const },
    };
    expect(renderInputKey(carousel, sora, 'MR')).not.toBe(key);
    // Un kit salvato prima della scelta dei font (senza `fonts`) dà la stessa chiave di prima.
    const legacy = {
      ...DEFAULT_BRAND_KIT,
      fonts: undefined,
    } as unknown as typeof DEFAULT_BRAND_KIT;
    expect(renderInputKey(carousel, legacy, 'MR')).toBe(key);
    expect(key).not.toContain('fonts');
    expect(
      renderInputKey(carousel, { ...DEFAULT_BRAND_KIT, voiceRules: ['Frasi brevi'] }, 'MR'),
    ).toBe(key);
  });
});

describe('font del kit', () => {
  it('usa i font scelti per titoli, testo e codice', () => {
    const kit = {
      ...DEFAULT_BRAND_KIT,
      fonts: { heading: 'playfair-display', body: 'manrope', code: 'fira-code' } as const,
    };
    const html = render(0, {}, kit);
    expect(html).toContain(
      "font-family:'Playfair Display',Georgia,serif;font-size:75px;font-weight:700",
    );
    expect(html).toContain("font-family:'Manrope',system-ui,sans-serif");
    expect(html).toContain("'Fira Code',ui-monospace");
    expect(html).not.toContain('JetBrains');
  });
});

describe('stili della fase 7b', () => {
  it('gradiente: fondo sfumato, bagliore e barra di avanzamento', () => {
    const html = render(1, { template: 'gradiente' });
    expect(html).toContain('linear-gradient(155deg,#101318,#4F46E5)');
    expect(html).toContain('<div class="deco"></div>');
    expect(html).toContain('<span class="progress"><span style="width:50%"></span></span>');
    expect(html).not.toContain('class="count"');
  });

  it('editoriale: segno e numeri in alto, titoli centrati con filetto', () => {
    const html = render(0, { template: 'editoriale' });
    expect(html).toMatch(
      /<header><span class="kicker">.*<span class="brand">.*<span class="count">1 \/ 4<\/span><\/header>/,
    );
    expect(html).toContain('<footer></footer>');
    expect(html).toContain('.title::before');
    expect(html).toContain('.content{align-items:center;text-align:center}');
  });

  it('bold: fondo accento e titoli maiuscoli più grandi', () => {
    const html = render(0, { template: 'bold' });
    expect(html).toContain('background:#4F46E5');
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain('.cover .title{font-size:115px}');
  });

  it('template del kit: stile usato nelle slide e nella chiave degli export', () => {
    const style = {
      ...BUILTIN_TEMPLATE_STYLES.griglia,
      background: { kind: 'image' as const, image: 'data:image/jpeg;base64,AA==', dim: 0.5 },
      logo: 'none' as const,
    };
    const kit = {
      ...DEFAULT_BRAND_KIT,
      templates: [{ id: 'tpl-abc12345' as const, name: 'Mio', style }],
    };
    const html = render(0, { template: 'tpl-abc12345' }, kit);
    expect(html).toContain('url("data:image/jpeg;base64,AA==") center/cover');
    expect(html).not.toContain('class="mark"');
    const carousel = CarouselSchema.parse({
      template: 'tpl-abc12345',
      slides: [{ kind: 'cover', title: 'T' }],
    });
    const key = renderInputKey(carousel, kit, 'MR');
    const changed = {
      ...kit,
      templates: [{ ...kit.templates[0]!, style: { ...style, uppercase: true } }],
    };
    expect(renderInputKey(carousel, changed, 'MR')).not.toBe(key);
    // Un template del kit eliminato torna a Tech scuro.
    expect(render(0, { template: 'tpl-zzz99999' })).toBe(render(0, { template: 'scuro' }));
  });
});
