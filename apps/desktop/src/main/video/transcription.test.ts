import type { VideoJobProgress } from '@prisma-app/shared';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessRunner } from './process.js';
import { LocalStore } from './store.js';
import { createTranscriptionService } from './transcription.js';
import {
  ffmpegAudioArgs,
  ffmpegProgress,
  parseWhisperJson,
  whisperArgs,
  whisperProgress,
} from './whisper.js';

const token = (text: string, from: number, to: number, p = 0.9) => ({
  text,
  offsets: { from, to },
  p,
});

const WHISPER_JSON = {
  result: { language: 'it' },
  transcription: [
    {
      text: ' Allora, vediamo.',
      tokens: [
        token('[_BEG_]', 0, 0),
        token(' Allora', 1500, 1800),
        token(',', 1800, 1900, 0.7),
        token(' vedia', 1950, 2200),
        token('mo', 2200, 2350),
        token('.', 2350, 2400),
        token('[_TT_120]', 2400, 2400),
      ],
    },
    { text: ' Avalonia', tokens: [token(' Avalonia', 2750, 3300, 0.5)] },
  ],
};

describe('whisper.cpp e FFmpeg', () => {
  it('ricompone le parole dai token, con tempi e probabilità', () => {
    expect(parseWhisperJson(WHISPER_JSON)).toEqual({
      language: 'it',
      words: [
        { text: 'Allora,', startMs: 1500, endMs: 1900, p: 0.8 },
        { text: 'vediamo.', startMs: 1950, endMs: 2400, p: 0.9 },
        { text: 'Avalonia', startMs: 2750, endMs: 3300, p: 0.5 },
      ],
    });
  });

  it('legge l’avanzamento di FFmpeg e di whisper', () => {
    expect(ffmpegProgress('out_time_ms=126200000', 252_400)).toBe(50);
    expect(ffmpegProgress('frame=10', 252_400)).toBeNull();
    expect(whisperProgress('whisper_print_progress_callback: progress =  45%')).toBe(45);
    expect(whisperProgress('whisper_init_from_file')).toBeNull();
  });

  it('costruisce i comandi senza passare da una shell', () => {
    expect(ffmpegAudioArgs('C:\\v.mp4', 'C:\\a.wav')).toEqual(
      expect.arrayContaining(['-i', 'C:\\v.mp4', '-ar', '16000', '-ac', '1', 'C:\\a.wav']),
    );
    expect(
      whisperArgs({ model: 'm.bin', wav: 'a.wav', outputBase: 'out', language: 'it', threads: 6 }),
    ).toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'it', '-t', '6', '-ojf', '-of', 'out', '-pp']);
  });
});

describe('servizio di trascrizione', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function setup(run: ProcessRunner) {
    dir = mkdtempSync(join(tmpdir(), 'prisma-trascrizione-'));
    const store = new LocalStore(join(dir, 'prisma.db'));
    const project = store.createProject({
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
    const progress: VideoJobProgress[] = [];
    const service = createTranscriptionService({
      store,
      requireTool: async (tool) => `C:\\tools\\${tool}.exe`,
      workRoot: join(dir, 'lavoro'),
      run,
      emit: (p) => progress.push(p),
      now: () => new Date('2026-11-22T12:00:00Z'),
      threads: 4,
    });
    return { store, project, progress, service, workRoot: join(dir, 'lavoro') };
  }

  it('estrae l’audio, trascrive e salva le parole nel progetto', async () => {
    const calls: string[] = [];
    const run: ProcessRunner = async (command, args, options) => {
      calls.push(command);
      if (command.endsWith('ffmpeg.exe')) {
        options?.onLine?.('out_time_ms=5000000', 'stdout');
      } else {
        options?.onLine?.('whisper_print_progress_callback: progress =  50%', 'stderr');
        const base = args[args.indexOf('-of') + 1]!;
        writeFileSync(`${base}.json`, JSON.stringify(WHISPER_JSON));
      }
      return { code: 0, stderrTail: '' };
    };
    const { store, project, progress, service, workRoot } = setup(run);

    const updated = await service.transcribe(project.id, 'it');
    expect(calls).toEqual(['C:\\tools\\ffmpeg.exe', 'C:\\tools\\whisper.exe']);
    expect(updated.transcript).toMatchObject({
      language: 'it',
      model: 'whisperModel.exe',
      createdAt: '2026-11-22T12:00:00.000Z',
    });
    expect(updated.transcript!.words).toHaveLength(3);
    expect(store.getProject(project.id)!.transcript!.words[0]!.text).toBe('Allora,');
    expect(progress).toEqual([
      { projectId: project.id, stage: 'audio', percent: 0 },
      { projectId: project.id, stage: 'audio', percent: 50 },
      { projectId: project.id, stage: 'trascrizione', percent: 0 },
      { projectId: project.id, stage: 'trascrizione', percent: 50 },
    ]);
    expect(existsSync(join(workRoot, project.id))).toBe(false);
    store.close();
  });

  it('riporta l’errore del programma e lascia il progetto com’era', async () => {
    const run: ProcessRunner = async () => ({ code: 1, stderrTail: 'riga 1\nInvalid data found' });
    const { store, project, service } = setup(run);
    await expect(service.transcribe(project.id, 'auto')).rejects.toThrow(/Invalid data found/);
    expect(store.getProject(project.id)!.transcript).toBeNull();
    store.close();
  });

  it('si può annullare e non avvia due lavori sullo stesso video', async () => {
    let release!: () => void;
    const run: ProcessRunner = (_command, _args, options) =>
      new Promise((resolve, reject) => {
        release = () => resolve({ code: 0, stderrTail: '' });
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const { store, project, service } = setup(run);
    const job = service.transcribe(project.id, 'it');
    await new Promise((r) => setTimeout(r, 10));
    expect(service.isRunning(project.id)).toBe(true);
    await expect(service.transcribe(project.id, 'it')).rejects.toThrow(/già in corso/);
    service.cancel(project.id);
    await expect(job).rejects.toThrow('Trascrizione annullata');
    expect(service.isRunning(project.id)).toBe(false);
    release();
    store.close();
  });
});
