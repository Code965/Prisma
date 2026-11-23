import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseProbe } from './ffprobe.js';
import { projectIdFromUrl } from './media-protocol.js';
import { LocalStore } from './store.js';
import { createVideoService } from './video-service.js';
import { toolStatus, type ToolEnvironment } from './tools.js';

function fakeEnv(files: Record<string, number>, probe: ToolEnvironment['probe']): ToolEnvironment {
  return {
    searchDirs: ['C:\\bin', 'C:\\winget'],
    modelDirs: ['C:\\dati\\whisper-models'],
    exists: (path) => path in files,
    list: (dir) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${dir}\\`))
        .map((f) => f.slice(dir.length + 1)),
    sizeOf: (path) => files[path] ?? 0,
    probe,
  };
}

describe('rilevamento degli strumenti video', () => {
  const versionProbe: ToolEnvironment['probe'] = async () => 'ffmpeg version 7.1 Copyright';

  it('trova gli eseguibili nel PATH e nei collegamenti di winget', async () => {
    const env = fakeEnv({ [join('C:\\winget', 'ffmpeg.exe')]: 1 }, versionProbe);
    expect(await toolStatus('ffmpeg', undefined, env)).toEqual({
      tool: 'ffmpeg',
      path: join('C:\\winget', 'ffmpeg.exe'),
      source: 'rilevato',
      detail: 'ffmpeg version 7.1 Copyright',
      error: null,
    });
    expect(await toolStatus('ffprobe', undefined, env)).toMatchObject({
      source: 'assente',
      path: null,
    });
  });

  it('FilmCraft si prova con la CLI accanto all’app, che con --version non esce', async () => {
    const app = join('C:\\winget', 'filmcraft.exe');
    const cli = join('C:\\winget', 'filmcraft-cli.exe');
    const probed: string[] = [];
    const env = fakeEnv({ [app]: 1, [cli]: 1 }, async (path) => {
      probed.push(path);
      return 'filmcraft-cli 0.20.1';
    });
    expect(await toolStatus('filmcraft', undefined, env)).toMatchObject({
      path: app,
      detail: 'filmcraft-cli 0.20.1',
      error: null,
    });
    expect(probed).toEqual([cli]);
    const withoutCli = fakeEnv({ [app]: 1 }, versionProbe);
    expect(await toolStatus('filmcraft', undefined, withoutCli)).toMatchObject({
      error: 'Manca filmcraft-cli.exe accanto all’app',
    });
  });

  it('usa il percorso impostato e segnala se non esiste o non parte', async () => {
    const env = fakeEnv({ 'D:\\tools\\whisper-cli.exe': 1 }, async () => {
      throw new Error('spawn EPERM');
    });
    expect(await toolStatus('whisper', 'D:\\tools\\whisper-cli.exe', env)).toMatchObject({
      source: 'impostato',
      error: 'Non si avvia: spawn EPERM',
    });
    expect(await toolStatus('ffmpeg', 'D:\\manca.exe', env)).toMatchObject({
      source: 'impostato',
      error: 'File non trovato',
    });
  });

  it('sceglie il modello Whisper più grande tra quelli presenti', async () => {
    const dir = 'C:\\dati\\whisper-models';
    const env = fakeEnv(
      {
        [`${dir}\\ggml-base.bin`]: 148 * 1024 * 1024,
        [`${dir}\\ggml-small.bin`]: 466 * 1024 * 1024,
        [`${dir}\\note.txt`]: 1,
      },
      versionProbe,
    );
    expect(await toolStatus('whisperModel', undefined, env)).toMatchObject({
      path: join(dir, 'ggml-small.bin'),
      source: 'rilevato',
      detail: '466 MB',
    });
  });
});

describe('metadati con ffprobe', () => {
  it('legge durata, dimensioni, fps e audio, e raddrizza i video ruotati', () => {
    const source = parseProbe(
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
            side_data_list: [{ rotation: -90 }],
          },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
        format: { duration: '252.400000', size: '73400320' },
      },
      'C:\\Video\\client-db.mp4',
    );
    expect(source).toEqual({
      path: 'C:\\Video\\client-db.mp4',
      fileName: 'client-db.mp4',
      sizeBytes: 73_400_320,
      durationMs: 252_400,
      width: 1080,
      height: 1920,
      fps: 29.97,
      videoCodec: 'h264',
      hasAudio: true,
    });
    expect(() => parseProbe({ streams: [{ codec_type: 'audio' }] }, 'x.mp3')).toThrow(/video/);
  });
});

describe('archivio locale SQLite', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('crea, elenca e rimuove i progetti, e sopravvive alla riapertura', () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-store-'));
    const file = join(dir, 'prisma.db');
    const source = {
      path: 'C:\\Video\\client-db.mp4',
      fileName: 'client-db.mp4',
      sizeBytes: 10,
      durationMs: 1000,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      hasAudio: true,
    };
    const store = new LocalStore(file, () => new Date('2026-11-22T10:00:00Z'));
    const project = store.createProject(source);
    expect(project).toMatchObject({ title: 'client-db', createdAt: '2026-11-22T10:00:00.000Z' });
    store.close();

    const reopened = new LocalStore(file);
    expect(reopened.listProjects().map((p) => p.id)).toEqual([project.id]);
    expect(reopened.getProject(project.id)?.source.path).toBe('C:\\Video\\client-db.mp4');
    reopened.removeProject(project.id);
    expect(reopened.listProjects()).toEqual([]);
    reopened.close();
  });

  it('crea un progetto Short dal video lungo: stesso file, tagli attorno al momento, 9:16', () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-store-'));
    const store = new LocalStore(join(dir, 'prisma.db'));
    const source = {
      path: 'C:\\Video\\lungo.mp4',
      fileName: 'lungo.mp4',
      sizeBytes: 10,
      durationMs: 600_000,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      hasAudio: true,
    };
    const parent = store.createProject(source);
    const video = createVideoService({ userDataDir: dir, store });
    const short = video.createShort({
      parentId: parent.id,
      contentId: 42,
      title: 'Da 30 secondi a 20 ms',
      startMs: 72_000,
      endMs: 101_000,
    });
    expect(short).toMatchObject({
      title: 'Da 30 secondi a 20 ms',
      source: { path: source.path },
      short: { parentId: parent.id, contentId: 42, startMs: 72_000, endMs: 101_000 },
      edit: {
        format: '9:16',
        cuts: [
          { startMs: 0, endMs: 72_000 },
          { startMs: 101_000, endMs: 600_000 },
        ],
      },
    });
    expect(store.listProjects()).toHaveLength(2);
    expect(() =>
      video.createShort({
        parentId: parent.id,
        contentId: 1,
        title: 'x',
        startMs: 0,
        endMs: 700_000,
      }),
    ).toThrow(/oltre la fine/);
    store.close();
  });
});

describe('protocollo prisma-media', () => {
  it('accetta solo indirizzi di progetto con un uuid', () => {
    const id = '8c1d4f3e-2a5b-4c6d-9e8f-0a1b2c3d4e5f';
    expect(projectIdFromUrl(`prisma-media://video/${id}`)).toBe(id);
    expect(projectIdFromUrl('prisma-media://video/../../Windows/win.ini')).toBeNull();
    expect(projectIdFromUrl('prisma-media://file/C:/x.mp4')).toBeNull();
    expect(projectIdFromUrl(`https://video/${id}`)).toBeNull();
  });
});
