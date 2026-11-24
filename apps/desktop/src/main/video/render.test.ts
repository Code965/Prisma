import { buildCaptions, type TranscriptWord, type VideoJobProgress } from '@prisma-app/shared';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assText, assTime, buildAss } from './ass.js';
import type { ProcessRunner } from './process.js';
import { createRenderService, renderFileName } from './render.js';
import {
  buildFilterGraph,
  ffmpegRenderArgs,
  loudnessGraph,
  mixLoudnessArgs,
  mixLoudnessGraph,
  voiceGainFromLoudnorm,
  zoomedCrop,
} from './render-plan.js';
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

  it('taglia, ritaglia e scala ogni parte, unisce e aggiunge i sottotitoli', () => {
    const graph = buildFilterGraph({
      parts: [
        { startMs: 0, endMs: 1500, scale: 1 },
        { startMs: 4200, endMs: 10_000, scale: 1 },
      ],
      crop,
      width: 1080,
      height: 1920,
      hasAudio: true,
      subtitles: 'sottotitoli.ass',
    });
    expect(graph).toBe(
      [
        '[0:v]trim=start=0.000:end=1.500,setpts=PTS-STARTPTS,crop=w=608:h=1080:x=656:y=0,scale=1080:1920:flags=lanczos,setsar=1[v0]',
        '[0:a]atrim=start=0.000:end=1.500,asetpts=PTS-STARTPTS[a0]',
        '[0:v]trim=start=4.200:end=10.000,setpts=PTS-STARTPTS,crop=w=608:h=1080:x=656:y=0,scale=1080:1920:flags=lanczos,setsar=1[v1]',
        '[0:a]atrim=start=4.200:end=10.000,asetpts=PTS-STARTPTS[a1]',
        '[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][aout]',
        '[vc]subtitles=filename=sottotitoli.ass[vout]',
      ].join(';\n') + '\n',
    );
  });

  it('senza audio e senza sottotitoli, e rifiuta un video tutto tagliato', () => {
    const graph = buildFilterGraph({
      parts: [{ startMs: 0, endMs: 1000, scale: 1 }],
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
      buildFilterGraph({ parts: [], crop, width: 1, height: 1, hasAudio: false, subtitles: null }),
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
      if (args.includes('misura.txt')) {
        // Primo passaggio: loudnorm stampa le misure; la voce è a −20 LUFS.
        for (const line of ['{', '\t"input_i" : "-20.00",', '\t"input_tp" : "-3.00",', '}']) {
          options?.onLine?.(line, 'stderr');
        }
        return { code: 0, stderrTail: '' };
      }
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
    // Volume uniforme con il guadagno misurato: da −20 a −14 LUFS.
    expect(seen.graph).toContain('volume=6.0dB,agate=threshold=0.04');
    expect(seen.graph).toContain('alimiter=limit=0.84:level=false');
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

describe('zoom, parole chiave e hook (fase 6a)', () => {
  it('lo zoom restringe il riquadro attorno al centro, con misure pari', () => {
    const crop = { x: 656, y: 0, width: 608, height: 1080 };
    expect(zoomedCrop(crop, 1)).toEqual(crop);
    expect(zoomedCrop(crop, 1.2)).toEqual({ x: 707, y: 90, width: 506, height: 900 });
    const graph = buildFilterGraph({
      parts: [{ startMs: 0, endMs: 1000, scale: 1.2 }],
      crop,
      width: 1080,
      height: 1920,
      hasAudio: false,
      subtitles: null,
    });
    expect(graph).toContain('crop=w=506:h=900:x=707:y=90,scale=1080:1920');
  });

  it('colora le parole chiave e mette l’hook in alto nei primi secondi', () => {
    const words = [
      { text: 'Rust', startMs: 0, endMs: 400, p: 1 },
      { text: 'vola.', startMs: 400, endMs: 800, p: 1 },
    ];
    const ass = buildAss({
      captions: [{ startMs: 0, endMs: 800, words }],
      cuts: [],
      style: 'clean',
      width: 1080,
      height: 1920,
      keywords: [0],
      hook: { text: 'Perché {Rust}', durationMs: 2500 },
    });
    expect(ass).toContain('Style: Hook,Segoe UI,96,');
    expect(ass).toContain(
      'Dialogue: 1,0:00:00.00,0:00:02.50,Hook,,0,0,0,,{\\fad(150,250)}Perché (Rust)',
    );
    expect(ass).toContain('{\\c&HF8BD38&}Rust{\\c&H00FFFFFF&} vola.');
  });
});

describe('audio del render (6b)', () => {
  it('ricava il guadagno della voce dalle misure di loudnorm', () => {
    expect(voiceGainFromLoudnorm('{\n "input_i" : "-23.40",\n}')).toBe(9.4);
    expect(voiceGainFromLoudnorm('"input_i" : "-inf"')).toBeNull();
    expect(voiceGainFromLoudnorm('niente')).toBeNull();
    expect(voiceGainFromLoudnorm('"input_i" : "-70.0"')).toBe(30);
    const graph = loudnessGraph([{ startMs: 0, endMs: 1000 }], {
      clean: true,
      normalize: true,
      music: null,
    });
    expect(graph).toContain('concat=n=1:v=0:a=1,highpass=f=80');
    expect(graph).toContain('print_format=json[aout]');
  });

  const parts = [{ startMs: 0, endMs: 10_000, scale: 1 }];
  const crop = { x: 0, y: 0, width: 1080, height: 1920 };
  const base = { parts, crop, width: 1080, height: 1920, subtitles: null };

  it('senza nulla da fare la voce montata va dritta nel file', () => {
    const graph = buildFilterGraph({
      ...base,
      hasAudio: true,
      audio: { clean: false, normalize: false, music: null },
    });
    expect(graph).toContain('concat=n=1:v=1:a=1[vc][aout]');
    expect(graph).not.toContain('[voce]');
  });

  it('voce ripulita e a −14 LUFS', () => {
    const graph = buildFilterGraph({
      ...base,
      hasAudio: true,
      audio: { clean: true, normalize: true, music: null },
    });
    expect(graph).toContain('[vc][voce]');
    expect(graph).toContain('[voce]highpass=f=80,afftdn=nr=20:nf=-45:tn=1,acompressor=');
    expect(graph).toContain('loudnorm=I=-14:TP=-1.5:LRA=11');
    expect(graph).toContain('[vpulita]anull[aout]');
    const onlyClean = buildFilterGraph({
      ...base,
      hasAudio: true,
      audio: { clean: true, normalize: false, music: null, voiceGainDb: 4 },
    });
    expect(onlyClean).toContain(
      'volume=4.0dB,agate=threshold=0.04:ratio=4:range=0.18:knee=1.5:attack=10:release=300,volume=-4.0dB',
    );
  });

  it('musica alla durata del video, in dissolvenza e abbassata dalla voce', () => {
    const graph = buildFilterGraph({
      ...base,
      hasAudio: true,
      audio: { clean: false, normalize: false, music: { volumeDb: -10, ducking: true } },
    });
    expect(graph).toContain('[1:a]atrim=duration=10.000');
    expect(graph).toContain(
      'volume=-10.0dB,afade=t=in:d=1.000,afade=t=out:st=8.000:d=2.000[musica]',
    );
    expect(graph).toContain('[musica][vcomando]sidechaincompress=');
    expect(graph).toContain('[vmix][mbassa]amix=inputs=2:duration=first:normalize=0');
    const args = ffmpegRenderArgs({
      source: 'v.mp4',
      graphFile: 'filtri.txt',
      output: 'o.mp4',
      hasAudio: false,
      music: 'C:\\Musica\\a.mp3',
    });
    expect(args.slice(2, 8)).toEqual([
      '-i',
      'v.mp4',
      '-stream_loop',
      '-1',
      '-i',
      'C:\\Musica\\a.mp3',
    ]);
    expect(args).toContain('[aout]');
  });

  it('con la musica misura anche il mix e ne corregge il volume', () => {
    const audio = {
      clean: true,
      normalize: true,
      music: { volumeDb: -10, ducking: true },
      voiceGainDb: 5,
    };
    const measure = mixLoudnessGraph([{ startMs: 0, endMs: 4000 }], true, audio);
    expect(measure).toContain('concat=n=1:v=0:a=1[voce]');
    expect(measure).toContain('volume=5.0dB');
    expect(measure).toContain('[aout]loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[misura]');
    expect(mixLoudnessArgs('v.mp4', 'm.mp3', 'misura-mix.txt')).toEqual([
      '-y',
      '-nostdin',
      '-i',
      'v.mp4',
      '-stream_loop',
      '-1',
      '-i',
      'm.mp3',
      '-/filter_complex',
      'misura-mix.txt',
      '-map',
      '[misura]',
      '-f',
      'null',
      '-',
    ]);
    const graph = buildFilterGraph({
      ...base,
      hasAudio: true,
      audio: { ...audio, mixGainDb: 1.8 },
    });
    expect(graph).toContain(
      'amix=inputs=2:duration=first:normalize=0,volume=1.8dB,alimiter=limit=0.95:level=false[aout]',
    );
  });

  it('un video muto con musica ha solo la musica', () => {
    const graph = buildFilterGraph({
      ...base,
      hasAudio: false,
      audio: { clean: true, normalize: true, music: { volumeDb: -6, ducking: true } },
    });
    expect(graph).toContain('concat=n=1:v=1:a=0[vc];');
    expect(graph).toContain('[musica]alimiter=limit=0.95:level=false[aout]');
    expect(graph).not.toContain('[voce]');
  });
});
