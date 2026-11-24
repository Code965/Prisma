import { DEFAULT_BRAND_KIT, type Overlay } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { overlayPlacement, overlayTemplate, renderOverlayCardHtml } from './overlay.js';

const base = { id: 'a', startMs: 0, endMs: 2000, body: '', code: '' };

describe('schede di testo sopra il video', () => {
  it('pagina trasparente grande quanto il video, testo con escape', () => {
    const overlay: Overlay = {
      ...base,
      kind: 'code',
      title: 'Match <Option>',
      code: 'if a < b {}',
    };
    const html = renderOverlayCardHtml({
      overlay,
      kit: DEFAULT_BRAND_KIT,
      template: 'scuro',
      width: 1080,
      height: 1920,
    });
    expect(html).toContain('background:transparent;width:1080px;height:1920px');
    expect(html).toContain('<h1>Match &lt;Option&gt;</h1>');
    expect(html).toContain('<pre>if a &lt; b {}</pre>');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<script');
  });

  it('elenchi con al massimo 4 punti numerati', () => {
    const overlay: Overlay = { ...base, kind: 'list', title: 'Punti', body: 'a\nb\nc\nd\ne' };
    const html = renderOverlayCardHtml({
      overlay,
      kit: DEFAULT_BRAND_KIT,
      template: 'chiaro',
      width: 1920,
      height: 1080,
    });
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain('<span class="num">04</span>');
  });

  it('posizioni: titolo in alto, codice a metà; in 16:9 a destra', () => {
    expect(overlayPlacement('title', 1080, 1920)).toEqual({ left: 0.07, top: 0.1, width: 0.86 });
    expect(overlayPlacement('code', 1080, 1920).top).toBe(0.5);
    expect(overlayPlacement('list', 1920, 1080).left).toBe(0.52);
    expect(overlayTemplate('code', 'chiaro')).toBe('codice');
    expect(overlayTemplate('title', 'chiaro')).toBe('chiaro');
  });
});
