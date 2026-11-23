import { DEFAULT_BRAND_KIT, type Carousel } from '@prisma-app/shared';
import { renderSlideHtml } from '@prisma-app/templates';
import { useCallback, useMemo } from 'react';
import { slideFontFaceCss } from '../components/SlideFrame/slide-fonts';
import { useBrand } from './brand';
import { useBrandKit } from './useBrandKit';

/** Funzione che disegna una slide con il brand kit e i font dell'app (anteprime dell'editor). */
export function useSlideRenderer(): (carousel: Carousel, index: number) => string {
  const { brand } = useBrand();
  const kit = useBrandKit().data ?? DEFAULT_BRAND_KIT;
  const fontFaceCss = useMemo(() => slideFontFaceCss(), []);
  const initials = brand?.initials ?? '';
  return useCallback(
    (carousel, index) => renderSlideHtml({ carousel, index, kit, initials, fontFaceCss }),
    [kit, initials, fontFaceCss],
  );
}
