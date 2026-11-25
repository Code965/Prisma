/// <reference types="electron-vite/node" />
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?asset';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?asset';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?asset';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?asset';
import spaceGrotesk400 from '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2?asset';
import spaceGrotesk600 from '@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2?asset';
import spaceGrotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2?asset';
import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?asset';
import poppins600 from '@fontsource/poppins/files/poppins-latin-600-normal.woff2?asset';
import poppins700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?asset';
import poppins800 from '@fontsource/poppins/files/poppins-latin-800-normal.woff2?asset';
import manrope400 from '@fontsource/manrope/files/manrope-latin-400-normal.woff2?asset';
import manrope600 from '@fontsource/manrope/files/manrope-latin-600-normal.woff2?asset';
import manrope700 from '@fontsource/manrope/files/manrope-latin-700-normal.woff2?asset';
import manrope800 from '@fontsource/manrope/files/manrope-latin-800-normal.woff2?asset';
import ibmPlexSans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?asset';
import ibmPlexSans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?asset';
import ibmPlexSans700 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?asset';
import sora400 from '@fontsource/sora/files/sora-latin-400-normal.woff2?asset';
import sora600 from '@fontsource/sora/files/sora-latin-600-normal.woff2?asset';
import sora700 from '@fontsource/sora/files/sora-latin-700-normal.woff2?asset';
import sora800 from '@fontsource/sora/files/sora-latin-800-normal.woff2?asset';
import playfairDisplay400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?asset';
import playfairDisplay600 from '@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff2?asset';
import playfairDisplay700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?asset';
import dmSerifDisplay400 from '@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2?asset';
import jetbrainsMono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?asset';
import jetbrainsMono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?asset';
import ibmPlexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?asset';
import ibmPlexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?asset';
import firaCode400 from '@fontsource/fira-code/files/fira-code-latin-400-normal.woff2?asset';
import firaCode500 from '@fontsource/fira-code/files/fira-code-latin-500-normal.woff2?asset';
import { SLIDE_FONTS, type SlideFontId } from '@prisma-app/shared';
import type { FontFile } from './fonts.js';

/**
 * File dei font delle slide (catalogo `SLIDE_FONTS` di shared), copiati da electron-vite accanto
 * al main (`?asset`). Solo i pesi che i template usano, sottoinsieme latino.
 */
const FILES: ReadonlyArray<{ font: SlideFontId; weight: number; path: string }> = [
  { font: 'inter', weight: 400, path: inter400 },
  { font: 'inter', weight: 600, path: inter600 },
  { font: 'inter', weight: 700, path: inter700 },
  { font: 'inter', weight: 800, path: inter800 },
  { font: 'space-grotesk', weight: 400, path: spaceGrotesk400 },
  { font: 'space-grotesk', weight: 600, path: spaceGrotesk600 },
  { font: 'space-grotesk', weight: 700, path: spaceGrotesk700 },
  { font: 'poppins', weight: 400, path: poppins400 },
  { font: 'poppins', weight: 600, path: poppins600 },
  { font: 'poppins', weight: 700, path: poppins700 },
  { font: 'poppins', weight: 800, path: poppins800 },
  { font: 'manrope', weight: 400, path: manrope400 },
  { font: 'manrope', weight: 600, path: manrope600 },
  { font: 'manrope', weight: 700, path: manrope700 },
  { font: 'manrope', weight: 800, path: manrope800 },
  { font: 'ibm-plex-sans', weight: 400, path: ibmPlexSans400 },
  { font: 'ibm-plex-sans', weight: 600, path: ibmPlexSans600 },
  { font: 'ibm-plex-sans', weight: 700, path: ibmPlexSans700 },
  { font: 'sora', weight: 400, path: sora400 },
  { font: 'sora', weight: 600, path: sora600 },
  { font: 'sora', weight: 700, path: sora700 },
  { font: 'sora', weight: 800, path: sora800 },
  { font: 'playfair-display', weight: 400, path: playfairDisplay400 },
  { font: 'playfair-display', weight: 600, path: playfairDisplay600 },
  { font: 'playfair-display', weight: 700, path: playfairDisplay700 },
  { font: 'dm-serif-display', weight: 400, path: dmSerifDisplay400 },
  { font: 'jetbrains-mono', weight: 400, path: jetbrainsMono400 },
  { font: 'jetbrains-mono', weight: 500, path: jetbrainsMono500 },
  { font: 'ibm-plex-mono', weight: 400, path: ibmPlexMono400 },
  { font: 'ibm-plex-mono', weight: 500, path: ibmPlexMono500 },
  { font: 'fira-code', weight: 400, path: firaCode400 },
  { font: 'fira-code', weight: 500, path: firaCode500 },
];

export const SLIDE_FONT_FILES: ReadonlyArray<FontFile & { font: SlideFontId }> = FILES.map(
  (file) => ({ ...file, family: SLIDE_FONTS[file.font].family }),
);
