import { DEFAULT_VIDEO_EDIT, type VideoProject } from '@prisma-app/shared';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStore } from '../store.js';
import { createControlClient, type ControlClient } from './control.js';
import {
  buildOtio,
  buildSrt,
  msToFrames,
  setupCommands,
  srtTime,
  videoClipIds,
} from './interchange.js';
import { createFilmcraftService, nearestFormat } from './service.js';

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, p: 0.9 });

const source = {
  path: 'C:\\Video\\demo prova.mp4',
  fileName: 'demo prova.mp4',
  sizeBytes: 100,
  durationMs: 20_000,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  hasAudio: true,
};

function project(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f',
    title: 'Client database',
    source,
    transcript: {
      language: 'it',
      model: 'ggml-small.bin',
      createdAt: '2026-11-22T10:00:00.000Z',
      words: [
        w('Ciao', 100, 500),
        w('a', 550, 600),
        w('tutti.', 600, 1000),
        w('Indici.', 10_000, 11_000),
      ],
    },
    edit: { ...DEFAULT_VIDEO_EDIT, cuts: [{ startMs: 5000, endMs: 9000 }], cropOffset: 0.25 },
    render: null,
    short: null,
    generated: null,
    filmcraft: null,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('OTIO e SRT per FilmCraft', () => {
  it('una clip per parte rimasta, in fotogrammi del sorgente, con il file come riferimento', () => {
    const otio = buildOtio(project());
    const [video, audio] = otio.tracks.children;
    expect(otio.tracks.children).toHaveLength(2);
    expect(video!.kind).toBe('Video');
    expect(audio!.kind).toBe('Audio');
    const ranges = video!.children.map((c) => [
      c.source_range.start_time.value,
      c.source_range.duration.value,
    ]);
    expect(ranges).toEqual([
      [0, 150],
      [270, 330],
    ]);
    expect(video!.children[0]!.media_references.DEFAULT_MEDIA.target_url).toBe(
      'file:///C:/Video/demo%20prova.mp4',
    );
    expect(msToFrames(1001, 29.97)).toBe(30);
  });

  it('senza audio c’è solo la traccia video', () => {
    const otio = buildOtio(project({ source: { ...source, hasAudio: false } }));
    expect(otio.tracks.children.map((t) => t.kind)).toEqual(['Video']);
  });

  it('SRT sui tempi del video montato', () => {
    expect(srtTime(3_723_045)).toBe('01:02:03,045');
    expect(buildSrt(project())).toBe(
      '1\n00:00:00,100 --> 00:00:01,000\nCiao a tutti.\n\n2\n00:00:06,000 --> 00:00:07,000\nIndici.\n\n',
    );
    expect(buildSrt(project({ transcript: null }))).toBeNull();
  });

  it('formato e ritaglio diventano dimensioni della sequenza, scala e posizione delle clip', () => {
    // 1920×1080 in 9:16: riquadro largo 608 px spostato al 25% → x = 328, centro a 632 px.
    const commands = setupCommands(project(), [4, 5], { path: 'C:\\s.srt', language: 'it' });
    expect(commands[0]).toEqual({
      id: 'sequence.settings',
      params: { width: 1080, height: 1920, fps: 30 },
    });
    const scale = 1080 / 608;
    expect(commands[1]).toEqual({
      id: 'effects.setParam',
      params: { clip: 4, effect: 'motion', param: 'scale', value: Math.round(scale * 10000) / 100 },
    });
    expect(commands[2]!.params.value).toEqual([
      Math.round((540 + (960 - 632) * scale) * 100) / 100,
      960,
    ]);
    expect(commands.at(-1)).toEqual({
      id: 'captions.import',
      params: { path: 'C:\\s.srt', name: 'Sottotitoli', language: 'it' },
    });
    const wide = setupCommands(
      project({ edit: { ...DEFAULT_VIDEO_EDIT, format: '16:9' } }),
      [1],
      null,
    );
    expect(wide.slice(1).map((c) => c.params.value)).toEqual([100, [960, 540]]);
  });

  it('legge gli id delle clip video da inspect', () => {
    expect(
      videoClipIds({ sequence: { video: [{ items: [{ clip: 4 }, { clip: 5 }] }, { items: [] }] } }),
    ).toEqual([4, 5]);
    expect(videoClipIds({})).toEqual([]);
    expect(nearestFormat(1080, 1920)).toBe('9:16');
    expect(nearestFormat(1920, 1080)).toBe('16:9');
  });
});

describe('canale di controllo', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  function fakeFilmcraft(handler: (request: Record<string, unknown>, count: number) => unknown) {
    const seen: Array<Record<string, unknown>> = [];
    server = createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const request = JSON.parse(buffer.slice(0, index)) as Record<string, unknown>;
          buffer = buffer.slice(index + 1);
          seen.push(request);
          socket.write(
            `${JSON.stringify({ id: request.id, ...(handler(request, seen.length) as object) })}\n`,
          );
        }
      });
    });
    return new Promise<{ port: number; seen: typeof seen }>((resolve) =>
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve({ port: typeof address === 'object' && address ? address.port : 0, seen });
      }),
    );
  }

  it('manda il token, ripete mentre FilmCraft si avvia e restituisce il risultato', async () => {
    const { port, seen } = await fakeFilmcraft((_request, count) =>
      count < 3
        ? { ok: false, error: 'FilmCraft is still starting; send the request again' }
        : { ok: true, result: { job: 7 } },
    );
    const client = createControlClient({ port, token: 'a'.repeat(64), startupMs: 5000 });
    await expect(client.exec('file.exportMedia', { path: 'x.mp4', wait: false })).resolves.toEqual({
      job: 7,
    });
    expect(seen).toHaveLength(3);
    expect(seen[2]).toMatchObject({
      token: 'a'.repeat(64),
      method: 'engine.execute',
      params: { command: 'file.exportMedia', params: { path: 'x.mp4', wait: false } },
    });
    client.close();
  });

  it('un errore di FilmCraft diventa un’eccezione con il suo messaggio', async () => {
    const { port } = await fakeFilmcraft(() => ({ ok: false, error: 'no such command' }));
    const client = createControlClient({ port, token: 't'.repeat(64) });
    await expect(client.call('nope')).rejects.toThrow('no such command');
    client.close();
  });

  it('senza FilmCraft in ascolto dice che non risponde', async () => {
    const client = createControlClient({ port: 1, token: 't'.repeat(64), startupMs: 200 });
    await expect(client.call('jobs.list')).rejects.toThrow(/non risponde/);
  });
});

describe('servizio FilmCraft', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function setup() {
    dir = mkdtempSync(join(tmpdir(), 'prisma-filmcraft-'));
    const appDir = join(dir, 'FilmCraft');
    mkdirSync(appDir);
    writeFileSync(join(appDir, 'filmcraft-cli.exe'), '');
    const store = new LocalStore(join(dir, 'prisma.db'));
    const created = store.createProject(source, 'Client database', {
      transcript: project().transcript,
      edit: project().edit,
    });
    const cliCalls: string[][] = [];
    const launches: Array<{ args: string[]; env: Record<string, string> }> = [];
    const commands: Array<[string, Record<string, unknown> | undefined]> = [];
    let progress = 0;
    const client: ControlClient = {
      call: async (method) => (commands.push([method, undefined]), null),
      exec: async (command, params) => {
        commands.push([command, params]);
        if (command === 'file.exportMedia') {
          writeFileSync(String(params!.path), 'mp4');
          return { job: 3 };
        }
        if (command === 'jobs.list') {
          progress += 0.5;
          return [
            {
              id: 3,
              finished: progress >= 1,
              progress: Math.min(progress, 1),
              result: progress >= 1 ? { path: 'x' } : null,
            },
          ];
        }
        return null;
      },
      close: () => undefined,
    };
    const emitted: Array<number | null> = [];
    const service = createFilmcraftService({
      store,
      requireTool: async (tool) =>
        tool === 'filmcraft' ? join(appDir, 'filmcraft.exe') : 'ffprobe.exe',
      workRoot: join(dir, 'filmcraft'),
      exportsRoot: join(dir, 'esportazioni'),
      run: async (_cmd, args, options) => {
        cliCalls.push([...args]);
        if (args.includes('inspect')) {
          options?.onLine?.(
            JSON.stringify({ sequence: { video: [{ items: [{ clip: 4 }] }] } }),
            'stdout',
          );
        }
        if (args.includes('--save-as'))
          writeFileSync(args[args.indexOf('--save-as') + 1]!, 'fcproj');
        return { code: 0, stderrTail: '' };
      },
      probe: async () => ({ ...source, width: 1080, height: 1920, durationMs: 6000 }),
      emit: (p) => emitted.push(p.percent),
      launch: (_exe, args, env) => (launches.push({ args, env }), { isAlive: () => true }),
      connect: () => client,
      freePort: async () => 45678,
      now: () => new Date('2026-11-22T12:00:00Z'),
      pollMs: 1,
    });
    return { store, created, service, cliCalls, launches, commands, emitted };
  }

  it('prepara il progetto con la CLI, apre FilmCraft con il token nell’ambiente, esporta e rientra', async () => {
    const { store, created, service, cliCalls, launches, commands, emitted } = setup();
    const opened = await service.open(created.id);
    expect(cliCalls.map((args) => args.slice(1, 4).join(' '))).toEqual([
      expect.stringMatching(/^--save-as .*progetto\.fcproj import$/),
      expect.stringMatching(/^--project .*progetto\.fcproj inspect$/),
      expect.stringMatching(/^--project .*progetto\.fcproj --save$/),
    ]);
    expect(launches).toHaveLength(1);
    expect(launches[0]!.args.slice(0, 3)).toEqual(['--control', '45678', '--no-recover']);
    expect(launches[0]!.env.FILMCRAFT_CONTROL_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(launches[0]!.args.join(' ')).not.toContain(launches[0]!.env.FILMCRAFT_CONTROL_TOKEN);
    expect(opened.filmcraft?.projectPath).toMatch(/progetto\.fcproj$/);
    expect(service.status(created.id)).toEqual({ connected: true, stale: false });

    // Già aperto: nessuna nuova istanza.
    await service.open(created.id);
    expect(launches).toHaveLength(1);

    const exported = await service.exportReturn(created.id);
    expect(commands.map(([c]) => c)).toEqual([
      'file.save',
      'file.exportMedia',
      'jobs.list',
      'jobs.list',
    ]);
    expect(commands[1]![1]).toMatchObject({
      format: 'h264',
      burnCaptions: true,
      range: 'entire',
      wait: false,
    });
    expect(emitted).toEqual([0, 50, 100]);
    expect(exported.filmcraft?.returned).toMatchObject({
      width: 1080,
      height: 1920,
      durationMs: 6000,
      sizeBytes: 3,
    });

    const used = service.useReturn(created.id);
    expect(used.render).toMatchObject({ origin: 'filmcraft', format: '9:16', durationMs: 6000 });
    expect(store.getProject(created.id)?.render?.origin).toBe('filmcraft');

    // Modifiche in Prisma dopo l'apertura: il progetto FilmCraft non le ha.
    store.updateProject({ ...used, edit: { ...used.edit, cuts: [] } });
    expect(service.status(created.id).stale).toBe(true);
    store.close();
  });

  it('senza l’app aperta da Prisma esporta con la CLI l’ultimo salvataggio', async () => {
    const { store, created, service, cliCalls } = setup();
    const opened = await service.open(created.id);
    const second = createFilmcraftService({
      store,
      requireTool: async () => join(dir!, 'FilmCraft', 'filmcraft.exe'),
      workRoot: join(dir!, 'filmcraft'),
      exportsRoot: join(dir!, 'esportazioni'),
      run: async (_cmd, args) => {
        cliCalls.push([...args]);
        const path = args.find((a) => a.startsWith('path='));
        if (path) writeFileSync(path.slice(5), 'video');
        return { code: 0, stderrTail: '' };
      },
      probe: async () => ({ ...source, width: 1080, height: 1920, durationMs: 6000 }),
      emit: () => undefined,
      now: () => new Date('2026-11-22T12:00:00Z'),
    });
    expect(second.status(created.id).connected).toBe(false);
    const exported = await second.exportReturn(created.id);
    expect(cliCalls.at(-1)).toEqual(
      expect.arrayContaining([
        '--project',
        opened.filmcraft!.projectPath,
        'exec',
        'file.exportMedia',
        'wait=true',
      ]),
    );
    expect(exported.filmcraft?.returned?.sizeBytes).toBe(5);
    store.close();
  });
});
