import { describe, expect, it } from 'vitest';
import { BrandKitSchema, DEFAULT_BRAND_KIT } from './brand-kit.js';
import { CarouselSchema } from './carousel.js';
import {
  BUILTIN_TEMPLATE_STYLES,
  DEFAULT_TEMPLATE_STYLE,
  TemplateStyleSchema,
  resolveTemplate,
  templateChoices,
} from './template-style.js';

const mine = {
  id: 'tpl-abc12345' as const,
  name: 'Il mio',
  style: { ...DEFAULT_TEMPLATE_STYLE, tone: 'accento' as const, uppercase: true },
};

describe('stili dei template', () => {
  it('gli stili pronti sono validi', () => {
    for (const style of Object.values(BUILTIN_TEMPLATE_STYLES)) {
      expect(TemplateStyleSchema.parse(style)).toEqual(style);
    }
  });

  it('accetta template pronti e del kit nei caroselli, non id inventati', () => {
    const slides = [{ kind: 'cover', title: 'T', body: '', code: '' }];
    expect(CarouselSchema.parse({ template: 'bold', slides }).template).toBe('bold');
    expect(CarouselSchema.parse({ template: 'tpl-abc12345', slides }).template).toBe(
      'tpl-abc12345',
    );
    expect(CarouselSchema.safeParse({ template: 'altro', slides }).success).toBe(false);
  });

  it('risolve lo stile e torna a Tech scuro se il template del kit non c’è più', () => {
    expect(resolveTemplate('editoriale', []).style.align).toBe('center');
    expect(resolveTemplate('tpl-abc12345', [mine])).toMatchObject({
      label: 'Il mio',
      custom: true,
    });
    expect(resolveTemplate('tpl-zzz99999', [mine])).toMatchObject({ id: 'scuro', custom: false });
    expect(templateChoices([mine]).map((c) => c.id)).toContain('tpl-abc12345');
  });

  it('i kit salvati prima non hanno template e restano validi', () => {
    const old: Record<string, unknown> = { ...DEFAULT_BRAND_KIT };
    delete old.templates;
    expect(BrandKitSchema.parse(old).templates).toEqual([]);
    expect(
      BrandKitSchema.parse({ ...DEFAULT_BRAND_KIT, templates: [mine] }).templates,
    ).toHaveLength(1);
  });

  it('rifiuta un fondo immagine non valido', () => {
    expect(
      TemplateStyleSchema.safeParse({
        ...DEFAULT_TEMPLATE_STYLE,
        background: { kind: 'image', image: 'https://x/y.jpg', dim: 0.4 },
      }).success,
    ).toBe(false);
  });
});
