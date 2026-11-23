import { buildCaptions, type TranscriptWord, type VideoJobProgress } from '@prisma-app/shared';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assText, assTime, buildAss } from './ass.js';
import type { ProcessRunner } from './process.js';
import { createRenderService, renderFileName } from './render.js';
import { buildFilterGraph, ffmpegRenderArgs } from './render-plan.js';
import { LocalStore } from './store.js';

const w = (text: string, startMs: number, endMs: number): TranscriptWord => ({
  text,
  startMs,
  endMs,
  p: 0.9,
});
const WORDS = [
  w('La', 1000, 1200),
  w('soluzione', 1250, 1700),
  w('è', 1750, 1850),
  w('{una}', 1900, 2100),
  w('riga.', 2150, 2500),
];

describe('sottotitoli ASS', () => {
  it('formatta tempi e protegge il testo', () => {
    expect(assTime(3_725_430)).toBe('1:02:05.43');
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assText('a {\\b1} b\\N')).toBe('a (/b1) b/N');
  });

  it('dimensiona lo stile sul video finale e sposta i tempi dopo i tagli', () => {
    const captions = buildCaptions(WORDS, []);
    const ass = buildAss({
      captions,
      cuts: [{ startMs: 0, endMs: 1000 }],
      style: 'box',
      width: 1080,
      height: 1920,
    });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    // Riquadro opaco (BorderStyle 3), testo di 61 px su 1920.
    expect(ass).toMatch(/Style: Default,Segoe UI,61,.*,3,12,0,2,/);
    expect(ass).toContain(
      'Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,La soluzione è (una) riga.',
    );
  });

  it('parola per parola: una riga per parola con la parola attiva gialla', () => {
    const ass = buildAss({
      captions: buildCaptions(WORDS, []),
      cuts: [],
      style: 'word',
      width: 1080,
      height: 1920,
    });
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue'));
    expect(dialogues).toHaveLength(5);
    expect(dialogues[1]).toContain('0:00:01.25,0:00:01.75');
    expect(dialogues[1]).toContain('La {\\c&H15CCFA&}soluzione{\\c&H00FFFFFF&} è');
    const big = buildAss({
      captions: buildCaptions(WORDS, []),
      cuts: [],
      style: 'big',
      width: 1080,
      height: 1920,
    });
    expect(big).toContain(',,SOLUZIONE');
  });
});

describe('grafo dei filtri', () => {
  const crop = { x: 656, y: 0, width: 608, height: 1080 };

  it('taglia, unisce, ritaglia, scala e aggiunge i sottotitoli', () => {
    const graph = buildFilterGraph({
      kept: [
        { startMs: 0, endMs: 1500 },
        { startMs: 4200, endMs: 10_000 },
      ],
      crop,
      width: 1080,
      height: 1920,
      hasAudio: true,
      subtitles: 'sottotitoli.ass',
    });
    expect(graph).toBe(
      [
        '[0:v]trim=start=0.000:end=1.500,setpts=PTS-STARTPTS[v0]',
        '[0:a]atrim=start=0.000:end=1.500,asetpts=PTS-STARTPTS[a0]',
        '[0:v]trim=start=4.200:end=10.000,setpts=PTS-STARTPTS[v1]',
        '[0:a]atrim=start=4.200:end=10.000,asetpts=PTS-STARTPTS[a1]',
        '[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][aout]',
        '[vc]crop=w=608:h=1080:x=656:y=0,scale=1080:1920:flags=lanczos,setsar=1,subtitles=filename=sottotitoli.ass[vout]',
      ].join(';\n') + '\n',
    );
  });

  it('senza audio e senza sottotitoli, e rifiuta un video tutto tagliato', () => {
    const graph = buildFilterGraph({
      kept: [{ startMs: 0, endMs: 1000 }],
      crop,
      width: 1080,
      height: 1920,
      hasAudio: false,
      subtitles: null,
    });
    expect(graph).not.toContain('atrim');
    expect(graph).toContain('concat=n=1:v=1:a=0[vc]\n'.replace('\n', ';'));
    expect(graph).not.toContain('subtitles');
    expect(() =>
      buildFilterGraph({ kept: [], crop, width: 1, height: 1, hasAudio: false, subtitles: null }),
    ).toThrow(/tagliato/);
    expect(
      ffmpegRenderArgs({
        source: 's.mp4',
        graphFile: 'filtri.txt',
        output: 'o.mp4',
        hasAudio: false,
      }),
    ).not.toContain('[aout]');
  });
});

describe('servizio di render', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function setup(run: ProcessRunner) {
    dir = mkdtempSync(join(tmpdir(), 'prisma-render-'));
    const store = new LocalStore(join(dir, 'prisma.db'));
    const created = store.createProject({
      path: 'C:\\Video\\client-db.mp4',
      fileName: 'client-db.mp4',
      sizeBytes: 10,
      durationMs: 10_000,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      hasAudio: true,
    });
    const project = {
      ...created,
      transcript: {
        language: 'it',
        model: 'ggml-small.bin',
        words: WORDS,
        createdAt: created.createdAt,
      },
      edit: { ...created.edit, cuts: [{ startMs: 5000, endMs: 10_000 }] },
    };
    store.updateProject(project);
    const progress: VideoJobProgress[] = [];
    const service = createRenderService({
      store,
      requireTool: async () => 'C:\\tools\\ffmpeg.exe',
      workRoot: join(dir, 'lavoro'),
      exportsRoot: join(dir, 'esportazioni'),
      run,
      emit: (p) => progress.push(p),
      now: () => new Date('2026-11-22T12:00:00Z'),
      measureDurationMs: async () => 4967,
    });
    return { store, project, service, progress, dir };
  }

  it('scrive grafo e sottotitoli, lancia FFmpeg nella cartella di lavoro e salva il risultato', async () => {
    const seen: { cwd?: string; graph?: string; ass?: string } = {};
    const run: ProcessRunner = async (_command, args, options) => {
      seen.cwd = options?.cwd;
      seen.graph = readFileSync(join(options!.cwd!, 'filtri.txt'), 'utf8');
      seen.ass = readFileSync(join(options!.cwd!, 'sottotitoli.ass'), 'utf8');
      options?.onLine?.('out_time_ms=2500000', 'stdout');
      writeFileSync(args[args.length - 1]!, 'video finto');
      return { code: 0, stderrTail: '' };
    };
    const { store, project, service, progress } = setup(run);
    const updated = await service.render(project.id);

    expect(seen.graph).toContain('trim=start=0.000:end=5.000');
    expect(seen.ass).toContain('La soluzione');
    expect(updated.render).toMatchObject({
      format: '9:16',
      width: 1080,
      height: 1920,
      // Durata misurata sul file, non quella calcolata dai tagli (5000).
      durationMs: 4967,
      sizeBytes: 11,
    });
    expect(updated.render!.path).toContain(
      renderFileName(project.id, '9:16', new Date('2026-11-22T12:00:00Z')),
    );
    expect(service.isUpToDate(updated)).toBe(true);
    expect(service.isUpToDate({ ...updated, edit: { ...updated.edit, subtitles: 'clean' } })).toBe(
      false,
    );
    expect(progress.at(-1)).toEqual({ projectId: project.id, stage: 'render', percent: 50 });
    expect(existsSync(seen.cwd!)).toBe(false);
    expect(store.getProject(project.id)!.render!.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    store.close();
  });

  it('in caso di errore non lascia file a metà e non tocca il progetto', async () => {
    let output = '';
    const run: ProcessRunner = async (_command, args) => {
      output = args[args.length - 1]!;
      writeFileSync(output, 'a metà');
      return { code: 1, stderrTail: 'Error initializing filter subtitles' };
    };
    const { store, project, service } = setup(run);
    await expect(service.render(project.id)).rejects.toThrow(/filter subtitles/);
    expect(existsSync(output)).toBe(false);
    expect(store.getProject(project.id)!.render).toBeNull();
    store.close();
  });
});
