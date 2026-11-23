import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?url';
import mono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import mono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url';

const face = (family: string, weight: number, url: string) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url('${new URL(url, document.baseURI).href}') format('woff2')}`;

/**
 * `@font-face` per le slide: gli stessi file inclusi nell'app, con indirizzi assoluti perché
 * l'iframe `srcdoc` non ha un indirizzo base proprio.
 */
export function slideFontFaceCss(): string {
  return [
    face('Inter', 400, inter400),
    face('Inter', 600, inter600),
    face('Inter', 700, inter700),
    face('Inter', 800, inter800),
    face('JetBrains Mono', 400, mono400),
    face('JetBrains Mono', 500, mono500),
  ].join('');
}
