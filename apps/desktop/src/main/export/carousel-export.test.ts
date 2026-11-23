import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFolderName, slideFileName } from './carousel-export.js';

describe('nomi dei file esportati', () => {
  it('una cartella per variante, formato e istante', () => {
    expect(exportFolderName(42, 'jpg', new Date('2026-11-22T09:05:07Z'))).toBe(
      join('variante-42', '20261122-090507-jpg'),
    );
  });

  it('numera le slide con due cifre', () => {
    expect(slideFileName(0)).toBe('slide-01.jpg');
    expect(slideFileName(9)).toBe('slide-10.jpg');
  });
});
