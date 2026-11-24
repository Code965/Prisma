import type { VideoProject } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  canCreateVideoFrom,
  createVideoLabel,
  generatedLabel,
  scriptRequest,
} from './create-video';
import { musicFolderLabel, projectListMeta } from './video';

describe('«Crea video dall’idea»', () => {
  it('chiede il copione da un’idea o da una bozza', () => {
    expect(scriptRequest({ kind: 'idea', id: 3 })).toEqual({ ideaId: 3 });
    expect(scriptRequest({ kind: 'variant', id: 9 })).toEqual({ variantId: 9 });
  });

  it('solo dalle bozze delle piattaforme video', () => {
    expect(canCreateVideoFrom('youtube')).toBe(true);
    expect(canCreateVideoFrom('tiktok')).toBe(true);
    expect(canCreateVideoFrom('blog')).toBe(false);
  });

  it('dice a che punto è', () => {
    expect(createVideoLabel(null)).toBe('Scrivo il copione con l’AI…');
    expect(createVideoLabel({ projectId: 'x', stage: 'voce', percent: 40 })).toBe(
      'Leggo il copione con la voce · 40%',
    );
    expect(createVideoLabel({ projectId: 'x', stage: 'trascrizione', percent: null })).toBe(
      'Trascrivo con Whisper…',
    );
  });

  it('descrive il video creato nell’elenco', () => {
    const project = {
      source: { durationMs: 47_000, width: 1080, height: 1920 },
      short: null,
      generated: { source: 'idea', sourceId: 1, voice: 'Voce di Windows', scenes: 6 },
      edit: { cuts: [] },
    } as unknown as VideoProject;
    expect(projectListMeta(project)).toBe('Dall’idea · 0:47 · 9:16');
    expect(generatedLabel(project)).toBe('Creato dall’idea · 6 scene · Voce di Windows');
  });
});

describe('cartella della musica nelle Impostazioni', () => {
  it('riassume lo stato', () => {
    expect(musicFolderLabel(null)).toBe('Non scelta');
    expect(musicFolderLabel({ dir: 'C:\\M', tracks: [], error: 'Cartella non trovata' })).toBe(
      'Cartella non trovata',
    );
    expect(musicFolderLabel({ dir: 'C:\\M', tracks: [1, 2], error: null })).toBe('2 brani');
    expect(musicFolderLabel({ dir: 'C:\\M', tracks: [1], error: null })).toBe('1 brano');
  });
});
