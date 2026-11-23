import { readFile } from 'node:fs/promises';

export interface FontFile {
  family: string;
  weight: number;
  path: string;
}

/**
 * `@font-face` con i font incorporati come data URL: il documento da esportare non dipende
 * da file esterni né dall'origine da cui viene caricato.
 */
export async function embeddedFontFaceCss(files: readonly FontFile[]): Promise<string> {
  const faces = await Promise.all(
    files.map(async ({ family, weight, path }) => {
      const data = (await readFile(path)).toString('base64');
      return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
    }),
  );
  return faces.join('');
}
