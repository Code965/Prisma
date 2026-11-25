import { DEFAULT_VIDEO_EDIT, type VideoProject } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { clockLabel, filmcraftView } from './filmcraft';

const base: VideoProject = {
  id: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
  title: 'Client database',
  source: {
    path: 'C:\\v.mp4',
    fileName: 'v.mp4',
    sizeBytes: 1,
    durationMs: 60_000,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    hasAudio: true,
  },
  transcript: null,
  edit: DEFAULT_VIDEO_EDIT,
  render: null,
  short: null,
  generated: null,
  faces: null,
  filmcraft: null,
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
};

const returned = {
  path: 'C:\\dati\\esportazioni\\video-x\\20261122-185800-filmcraft.mp4',
  width: 1080,
  height: 1920,
  durationMs: 30_000,
  sizeBytes: 10,
  checksumSha256: 'a'.repeat(64),
  createdAt: '2026-11-22T18:58:00.000Z',
};
const opened = {
  projectPath: 'C:\\dati\\filmcraft\\x\\progetto.fcproj',
  editKey: 'b'.repeat(64),
  openedAt: '2026-11-22T18:42:00.000Z',
  returned: null,
};

describe('filmcraftView', () => {
  it('senza FilmCraft il pulsante è spento', () => {
    expect(filmcraftView(base, { installed: false, connected: false })).toMatchObject({
      button: { action: null },
      status: { text: 'Non installato' },
    });
  });

  it('segue gli stati del mockup: aperto, rientrato, sincronizzato', () => {
    const open = { ...base, filmcraft: opened };
    expect(filmcraftView(base, { installed: true, connected: false }).button.action).toBe('open');
    expect(filmcraftView(open, { installed: true, connected: true })).toEqual({
      button: { label: 'Esporta da FilmCraft', action: 'export' },
      status: { text: 'Aperto in FilmCraft · in attesa dell’esportazione', tone: 'review' },
      canReopen: false,
    });
    const back = { ...base, filmcraft: { ...opened, returned } };
    expect(filmcraftView(back, { installed: true, connected: true })).toMatchObject({
      button: { action: 'use' },
      status: { text: 'Rientrato: 20261122-185800-filmcraft.mp4 · 19:58', tone: 'ok' },
    });
    const used = {
      ...back,
      render: {
        ...returned,
        format: '9:16' as const,
        origin: 'filmcraft' as const,
        renderKey: 'a'.repeat(64),
      },
    };
    expect(filmcraftView(used, { installed: true, connected: false })).toMatchObject({
      button: { action: 'open' },
      status: { text: 'Sincronizzato · video finale delle 19:58', tone: 'pub' },
    });
    // Ancora aperto dopo averlo usato: si può esportare di nuovo.
    expect(filmcraftView(used, { installed: true, connected: true }).button.action).toBe('export');
  });

  it('con FilmCraft chiuso propone l’ultimo salvataggio e la riapertura', () => {
    expect(
      filmcraftView({ ...base, filmcraft: opened }, { installed: true, connected: false }),
    ).toMatchObject({
      button: { action: 'export', label: 'Esporta l’ultimo salvataggio' },
      canReopen: true,
    });
  });

  it('orari in ora italiana', () => {
    expect(clockLabel('2026-07-01T12:05:00.000Z')).toBe('14:05');
  });
});
