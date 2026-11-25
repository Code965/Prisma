import { BUILTIN_TEMPLATE_STYLES, DEFAULT_BRAND_KIT, type BrandKit } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  backgroundOfKind,
  copyName,
  draftError,
  duplicateDraft,
  fitSize,
  newTemplateId,
  removeTemplate,
  saveTemplate,
} from './template-editor';

const mine = { id: 'tpl-aaaaaaaa' as const, name: 'Mio', style: BUILTIN_TEMPLATE_STYLES.bold };
const kit: BrandKit = { ...DEFAULT_BRAND_KIT, templates: [mine] };

describe('editor dei template', () => {
  it('crea id validi e nomi di copia senza doppioni', () => {
    expect(newTemplateId(() => 0)).toBe('tpl-aaaaaaaa');
    expect(newTemplateId()).toMatch(/^tpl-[a-z0-9]{8}$/);
    expect(copyName('Bold', [])).toBe('Copia di Bold');
    expect(copyName('Bold', ['Copia di Bold', 'Copia di Bold 2'])).toBe('Copia di Bold 3');
  });

  it('duplica uno stile pronto o del kit', () => {
    const draft = duplicateDraft('editoriale', kit.templates);
    expect(draft).toMatchObject({ id: null, name: 'Copia di Editoriale' });
    expect(draft.style).toEqual(BUILTIN_TEMPLATE_STYLES.editoriale);
    expect(draft.style).not.toBe(BUILTIN_TEMPLATE_STYLES.editoriale);
    expect(duplicateDraft('tpl-aaaaaaaa', kit.templates).name).toBe('Copia di Mio');
  });

  it('controlla nome e numero massimo', () => {
    const draft = { id: null, name: ' ', style: mine.style };
    expect(draftError(draft, kit.templates)).toBe('Dai un nome al template');
    expect(draftError({ ...draft, name: 'Mio' }, kit.templates)).toMatch(/già un template/);
    expect(draftError({ ...draft, id: mine.id, name: 'Mio' }, kit.templates)).toBeNull();
    const full = Array.from({ length: 12 }, (_, i) => ({
      ...mine,
      id: `tpl-0000000${i % 10}` as const,
      name: `T${i}`,
    }));
    expect(draftError({ ...draft, name: 'Nuovo' }, full)).toMatch(/Al massimo 12/);
  });

  it('salva nuovi template in fondo e quelli esistenti al loro posto', () => {
    const added = saveTemplate(
      kit,
      { id: null, name: ' Nuovo ', style: mine.style },
      () => 'tpl-bbbbbbbb',
    );
    expect(added.id).toBe('tpl-bbbbbbbb');
    expect(added.kit.templates.map((t) => t.name)).toEqual(['Mio', 'Nuovo']);
    const renamed = saveTemplate(kit, { id: mine.id, name: 'Rinominato', style: mine.style });
    expect(renamed.kit.templates).toEqual([{ ...mine, name: 'Rinominato' }]);
  });

  it('eliminando un predefinito si torna a Tech scuro', () => {
    const used = { ...kit, carouselTemplate: mine.id, videoTemplate: 'bold' as const };
    expect(removeTemplate(used, mine.id)).toMatchObject({
      templates: [],
      carouselTemplate: 'scuro',
      videoTemplate: 'bold',
    });
  });

  it('cambia tipo di sfondo e riduce le foto', () => {
    expect(backgroundOfKind('gradient', { kind: 'solid' })).toMatchObject({ kind: 'gradient' });
    expect(backgroundOfKind('image', { kind: 'solid' })).toEqual({ kind: 'solid' });
    expect(fitSize(4000, 3000)).toEqual({ width: 1350, height: 1013 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
