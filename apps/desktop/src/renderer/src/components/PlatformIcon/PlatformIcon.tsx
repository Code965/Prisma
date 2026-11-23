import { PLATFORM_CODES, PLATFORM_LABELS, type Platform } from '@prisma-app/shared';
import type { CSSProperties, ReactElement } from 'react';
import styles from './PlatformIcon.module.css';

/**
 * Icona piattaforma con colore di accento (V3Icon del mockup). Le icone sono generiche:
 * vanno sostituite con i loghi ufficiali dai brand kit delle piattaforme.
 */
const GLYPHS: Record<Platform, ReactElement> = {
  linkedin: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </>
  ),
  instagram: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M8 6l1.5-2h5L16 6" />
    </>
  ),
  tiktok: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  // Il blog non è nel mockup: un foglio con righe, nello stesso stile a tratto.
  blog: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
      <path d="M9 12h7" />
      <path d="M9 16h7" />
    </>
  ),
};

interface PlatformIconProps {
  platform: Platform;
  /** Lato in pixel (16–48), default 24 come nel mockup. */
  size?: number;
}

export function PlatformIcon({ platform, size = 24 }: PlatformIconProps) {
  const code = PLATFORM_CODES[platform];
  const label = PLATFORM_LABELS[platform];
  const glyph = Math.round(size * 0.6);
  const style = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.28),
    background: `var(--${code}Soft)`,
    color: `var(--${code})`,
  } satisfies CSSProperties;

  return (
    <span role="img" aria-label={label} title={label} className={styles.icon} style={style}>
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {GLYPHS[platform]}
      </svg>
    </span>
  );
}
