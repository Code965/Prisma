import {
  BRAND_COLOR_LABELS,
  BRAND_COLOR_ROLES,
  LOGO_MAX_BYTES,
  PLATFORM_LABELS,
  type BrandColorRole,
  type BrandKit,
  type VoiceExample,
} from '@prisma-app/shared';

/** Parte del kit modificata nel pannello «Brand kit» (le regole della voce si salvano subito). */
export type KitDraft = Pick<BrandKit, 'colors' | 'handle' | 'logo' | 'videoTemplate'>;

export function kitDraft(kit: BrandKit): KitDraft {
  return {
    colors: { ...kit.colors },
    handle: kit.handle,
    logo: kit.logo,
    videoTemplate: kit.videoTemplate,
  };
}

export function isDraftChanged(draft: KitDraft, kit: BrandKit): boolean {
  return (
    draft.handle.trim().replace(/^@+/, '') !== kit.handle ||
    draft.logo !== kit.logo ||
    draft.videoTemplate !== kit.videoTemplate ||
    BRAND_COLOR_ROLES.some((role) => draft.colors[role].toUpperCase() !== kit.colors[role])
  );
}

export interface ColorRow {
  role: BrandColorRole;
  name: string;
  use: string;
  hex: string;
}

export function colorRows(colors: BrandKit['colors']): ColorRow[] {
  return BRAND_COLOR_ROLES.map((role) => ({
    role,
    ...BRAND_COLOR_LABELS[role],
    hex: colors[role].toUpperCase(),
  }));
}

/** Aggiunge una regola della voce ignorando vuoti e doppioni (senza distinguere maiuscole). */
export function addRule(rules: readonly string[], rule: string): string[] {
  const clean = rule.trim().replace(/\s+/g, ' ');
  if (!clean || rules.some((r) => r.toLowerCase() === clean.toLowerCase())) return [...rules];
  return [...rules, clean];
}

export function removeRule(rules: readonly string[], rule: string): string[] {
  return rules.filter((r) => r !== rule);
}

export function voiceExampleMeta(example: VoiceExample): string {
  const kind =
    example.platform === 'blog' ? 'Articolo del blog' : `Post ${PLATFORM_LABELS[example.platform]}`;
  return example.note ? `${kind} · ${example.note}` : kind;
}

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Controllo del file scelto come logo prima di leggerlo; null se va bene. */
export function logoFileError(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Il logo deve essere PNG, JPEG, WebP o SVG';
  if (file.size > LOGO_MAX_BYTES) return 'Il logo supera 256 KB';
  return null;
}

/** Template della galleria (V3Template), con le dimensioni di uscita. */
export interface GalleryTemplate {
  id: 'carosello' | 'post' | 'citazione' | 'codice' | 'miniatura_yt' | 'copertina_verticale';
  name: string;
  size: string;
}

export const GALLERY_TEMPLATES: readonly GalleryTemplate[] = [
  { id: 'carosello', name: 'Carosello', size: '1080×1350 · 3–10 slide' },
  { id: 'post', name: 'Post singolo', size: '1080×1350' },
  { id: 'citazione', name: 'Citazione', size: '1080×1080' },
  { id: 'codice', name: 'Snippet di codice', size: '1080×1350' },
  { id: 'miniatura_yt', name: 'Miniatura YouTube', size: '1280×720' },
  { id: 'copertina_verticale', name: 'Copertina Reel / TikTok', size: '1080×1920 · zone sicure' },
];
