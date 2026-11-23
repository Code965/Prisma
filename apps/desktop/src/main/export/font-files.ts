/// <reference types="electron-vite/node" />
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?asset';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?asset';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?asset';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?asset';
import mono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?asset';
import mono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?asset';
import type { FontFile } from './fonts.js';

/** File dei font delle slide, copiati da electron-vite accanto al main (`?asset`). */
export const SLIDE_FONT_FILES: readonly FontFile[] = [
  { family: 'Inter', weight: 400, path: inter400 },
  { family: 'Inter', weight: 600, path: inter600 },
  { family: 'Inter', weight: 700, path: inter700 },
  { family: 'Inter', weight: 800, path: inter800 },
  { family: 'JetBrains Mono', weight: 400, path: mono400 },
  { family: 'JetBrains Mono', weight: 500, path: mono500 },
];
