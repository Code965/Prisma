import {
  BACKGROUND_IMAGE_MAX_BYTES,
  resolveTemplate,
  type BrandKit,
  type CustomTemplate,
  type TemplateBackground,
  type TemplateId,
  type TemplateStyle,
} from '@prisma-app/shared';

/**
 * Editor dei template (fase 7c): logica pura. I template dell'utente stanno nel brand kit
 * (`kit.templates`, al massimo 12) e si salvano subito, come le regole della voce.
 */

export const MAX_CUSTOM_TEMPLATES = 12;

/** Template in modifica: nuovo (senza id) o già salvato. */
export interface TemplateDraft {
  id: CustomTemplate['id'] | null;
  name: string;
  style: TemplateStyle;
}

/** `tpl-` e 8 caratteri casuali in minuscolo e cifre. */
export function newTemplateId(random: () => number = Math.random): CustomTemplate['id'] {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(random() * chars.length)];
  return `tpl-${id}`;
}

/** «Copia di Bold», poi «Copia di Bold 2»… senza doppioni fra i nomi del kit. */
export function copyName(source: string, taken: readonly string[]): string {
  const base = `Copia di ${source}`.slice(0, 40);
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base.slice(0, 36)} ${n}`;
    if (!taken.includes(name)) return name;
  }
}

/** «Duplica e modifica»: bozza con lo stile del template di partenza e un nome nuovo. */
export function duplicateDraft(
  id: TemplateId,
  templates: readonly CustomTemplate[],
): TemplateDraft {
  const source = resolveTemplate(id, templates);
  return {
    id: null,
    name: copyName(
      source.label,
      templates.map((t) => t.name),
    ),
    style: structuredClone(source.style),
  };
}

export function editDraft(template: CustomTemplate): TemplateDraft {
  return { id: template.id, name: template.name, style: structuredClone(template.style) };
}

export function canAddTemplate(templates: readonly CustomTemplate[]): boolean {
  return templates.length < MAX_CUSTOM_TEMPLATES;
}

/** Errore da mostrare prima di salvare, o null. */
export function draftError(
  draft: TemplateDraft,
  templates: readonly CustomTemplate[],
): string | null {
  const name = draft.name.trim();
  if (!name) return 'Dai un nome al template';
  if (name.length > 40) return 'Nome troppo lungo (al massimo 40 caratteri)';
  if (templates.some((t) => t.name === name && t.id !== draft.id)) {
    return 'C’è già un template con questo nome';
  }
  if (!draft.id && !canAddTemplate(templates)) {
    return `Al massimo ${MAX_CUSTOM_TEMPLATES} template: eliminane uno`;
  }
  return null;
}

/** Il kit con il template salvato (nuovo in fondo, esistente al suo posto). */
export function saveTemplate(
  kit: BrandKit,
  draft: TemplateDraft,
  makeId: () => CustomTemplate['id'] = newTemplateId,
): { kit: BrandKit; id: CustomTemplate['id'] } {
  const id = draft.id ?? makeId();
  const template: CustomTemplate = { id, name: draft.name.trim(), style: draft.style };
  const exists = kit.templates.some((t) => t.id === id);
  const templates = exists
    ? kit.templates.map((t) => (t.id === id ? template : t))
    : [...kit.templates, template];
  return { kit: { ...kit, templates }, id };
}

/**
 * Il kit senza il template; se era il predefinito di caroselli o video si torna a Tech scuro.
 * I caroselli che lo usavano restano validi e si vedono in Tech scuro.
 */
export function removeTemplate(kit: BrandKit, id: CustomTemplate['id']): BrandKit {
  return {
    ...kit,
    templates: kit.templates.filter((t) => t.id !== id),
    carouselTemplate: kit.carouselTemplate === id ? 'scuro' : kit.carouselTemplate,
    videoTemplate: kit.videoTemplate === id ? 'scuro' : kit.videoTemplate,
  };
}

/** Sfondo predefinito quando si cambia tipo nell'editor. */
export function backgroundOfKind(
  kind: TemplateBackground['kind'],
  current: TemplateBackground,
): TemplateBackground {
  if (kind === current.kind) return current;
  switch (kind) {
    case 'solid':
      return { kind: 'solid' };
    case 'gradient':
      return { kind: 'gradient', from: 'ink', to: 'accent', angle: 155 };
    case 'image':
      // L'immagine si sceglie subito dopo: finché manca resta il fondo attuale.
      return current;
  }
}

/** Byte di un data URL base64. */
export function dataUrlBytes(url: string): number {
  return Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);
}

export const BACKGROUND_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function backgroundFileError(file: { type: string }): string | null {
  return BACKGROUND_TYPES.includes(file.type) ? null : 'Scegli una foto JPEG, PNG o WebP';
}

/** Lato lungo della foto di sfondo: basta per la slide 1080×1350. */
export const BACKGROUND_MAX_SIDE = 1350;

/** Misure della foto ridotta (mai ingrandita). */
export function fitSize(width: number, height: number, max = BACKGROUND_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Foto di sfondo pronta per il kit: ridotta a 1350 px e salvata in JPEG, abbassando la qualità
 * finché sta nei 600 KB (le foto del telefono pesano molto di più).
 */
export async function prepareBackgroundImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  for (const quality of [0.86, 0.78, 0.68, 0.56, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(url) <= BACKGROUND_IMAGE_MAX_BYTES) return url;
  }
  throw new Error('La foto è troppo pesante anche ridotta: scegline un’altra');
}
