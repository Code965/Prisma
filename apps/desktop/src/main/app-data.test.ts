import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDataDir } from './app-data.js';

describe('cartella dei dati dell’app', () => {
  let appData: string | null = null;
  afterEach(() => {
    if (appData) rmSync(appData, { recursive: true, force: true });
    appData = null;
  });

  it('senza vecchia cartella usa quella nuova', () => {
    appData = mkdtempSync(join(tmpdir(), 'prisma-appdata-'));
    expect(resolveDataDir(appData)).toEqual({
      userData: join(appData, 'Prisma'),
      outcome: 'nuova',
    });
  });

  it('sposta la vecchia cartella, rinomina il database e corregge i percorsi dei progetti', () => {
    appData = mkdtempSync(join(tmpdir(), 'prisma-appdata-'));
    const legacy = join(appData, '@cronaca', 'desktop');
    mkdirSync(join(legacy, 'whisper-models'), { recursive: true });
    writeFileSync(join(legacy, 'whisper-models', 'ggml-small.bin'), 'modello');
    writeFileSync(join(legacy, 'Local State'), '{"os_crypt":{}}');
    const exportPath = join(legacy, 'esportazioni', 'video-1', 'a.mp4');
    const db = new DatabaseSync(join(legacy, 'cronaca.db'));
    db.exec('CREATE TABLE video_projects (id TEXT, data TEXT)');
    db.prepare('INSERT INTO video_projects VALUES (?, ?)').run(
      'p1',
      JSON.stringify({ render: { path: exportPath } }),
    );
    db.close();

    const result = resolveDataDir(appData);
    const target = join(appData, 'Prisma');
    expect(result).toEqual({ userData: target, outcome: 'spostata' });
    expect(existsSync(join(appData, '@cronaca'))).toBe(false);
    expect(readFileSync(join(target, 'whisper-models', 'ggml-small.bin'), 'utf8')).toBe('modello');
    expect(existsSync(join(target, 'Local State'))).toBe(true);
    expect(existsSync(join(target, 'cronaca.db'))).toBe(false);
    const moved = new DatabaseSync(join(target, 'prisma.db'));
    const data = JSON.parse(
      (moved.prepare('SELECT data FROM video_projects').get() as { data: string }).data,
    );
    moved.close();
    expect(data.render.path).toBe(join(target, 'esportazioni', 'video-1', 'a.mp4'));

    // Alla volta dopo non c'è più niente da spostare.
    expect(resolveDataDir(appData).outcome).toBe('nuova');
  });

  it('con tutte e due le cartelle porta nella nuova i dati che le mancano, senza sovrascrivere', () => {
    appData = mkdtempSync(join(tmpdir(), 'prisma-appdata-'));
    const legacy = join(appData, '@cronaca', 'desktop');
    const target = join(appData, 'Prisma');
    mkdirSync(join(legacy, 'whisper-models'), { recursive: true });
    mkdirSync(join(legacy, 'esportazioni', 'variante-1'), { recursive: true });
    mkdirSync(join(legacy, 'esportazioni', 'variante-2'), { recursive: true });
    writeFileSync(join(legacy, 'whisper-models', 'ggml-small.bin'), 'modello');
    writeFileSync(join(legacy, 'video-tools.json'), '{"whisper":"C:/w.exe"}');
    writeFileSync(join(legacy, 'esportazioni', 'variante-1', 'vecchio.jpg'), 'vecchio');
    mkdirSync(join(target, 'esportazioni', 'variante-1'), { recursive: true });
    writeFileSync(join(target, 'esportazioni', 'variante-1', 'nuovo.jpg'), 'nuovo');
    writeFileSync(join(target, 'prisma.db'), '');

    expect(resolveDataDir(appData)).toEqual({ userData: target, outcome: 'unita' });
    expect(readFileSync(join(target, 'whisper-models', 'ggml-small.bin'), 'utf8')).toBe('modello');
    expect(readFileSync(join(target, 'video-tools.json'), 'utf8')).toContain('w.exe');
    expect(existsSync(join(target, 'esportazioni', 'variante-2'))).toBe(true);
    // Una cartella già presente nella nuova non si tocca.
    expect(existsSync(join(target, 'esportazioni', 'variante-1', 'nuovo.jpg'))).toBe(true);
    expect(existsSync(join(target, 'esportazioni', 'variante-1', 'vecchio.jpg'))).toBe(false);
    expect(resolveDataDir(appData).outcome).toBe('nuova');
  });
});
