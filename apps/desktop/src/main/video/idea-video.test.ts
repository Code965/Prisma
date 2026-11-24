import { DEFAULT_BRAND_KIT, type ToolsStatus, type VideoScript } from '@prisma-app/shared';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseEngine, createIdeaVideoService } from './idea-video.js';
import type { ProcessRunner } from './process.js';
import { ffmpegColor, slideshowArgs, slideshowGraph, wavDurationMs } from './slideshow.js';
import { LocalStore } from './store.js';
import { ansiArgument, powershellArgs, sherpaArgs, windowsSpeechScript } from './tts.js';

/** WAV PCM mono 16 bit a 22.050 Hz della durata indicata. */
function wav(ms: number): Buffer {
  const byteRate = 22_050 * 2;
  const data = Math.round((byteRate * ms) / 1000);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(22_050, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

const tool = (
  name: ToolsStatus[number]['tool'],
  path: string | null,
  error: string | null = null,
) => ({
  tool: name,
  path,
  source: path ? ('rilevato' as const) : ('assente' as const),
  detail: null,
  error,
});

describe('voce locale', () => {
  it('passa i byte UTF-8 come caratteri della code page ANSI', () => {
    const arg = ansiArgument('perché', 1252);
    expect(arg).toBe('perchÃ©');
    // Windows riconverte i caratteri in byte della code page: tornano i byte UTF-8 originali.
    expect(Buffer.from(arg, 'latin1').toString('utf8')).toBe('perché');
    expect(ansiArgument('perché', 65001)).toBe('perché');
    expect(ansiArgument('perché', null)).toBe('perché');
  });

  it('chiama sherpa-onnx con i file della voce accanto al modello', () => {
    const args = sherpaArgs({
      voice: join('C:', 'voci', 'paola', 'it_IT-paola-medium.onnx'),
      output: 'voce-1.wav',
      text: 'Ciao',
      threads: 3,
      codePage: 1252,
    });
    expect(args).toEqual([
      `--vits-model=${join('C:', 'voci', 'paola', 'it_IT-paola-medium.onnx')}`,
      `--vits-tokens=${join('C:', 'voci', 'paola', 'tokens.txt')}`,
      `--vits-data-dir=${join('C:', 'voci', 'paola', 'espeak-ng-data')}`,
      '--num-threads=3',
      '--output-filename=voce-1.wav',
      'Ciao',
    ]);
  });

  it('la voce di Windows legge il testo da file e sceglie una voce italiana', () => {
    const script = windowsSpeechScript("C:\\l'utente\\voce.txt", 'C:\\out.wav');
    expect(script).toContain("ReadAllText('C:\\l''utente\\voce.txt'");
    expect(script).toContain("Culture.Name -eq 'it-IT'");
    const args = powershellArgs(script);
    expect(Buffer.from(args[3]!, 'base64').toString('utf16le')).toBe(script);
  });

  it('preferisce sherpa-onnx con una voce Piper, altrimenti la voce di Windows', () => {
    const both = [tool('tts', 'C:\\sherpa.exe'), tool('ttsVoice', 'C:\\voce.onnx')];
    expect(chooseEngine(both, 'win32')).toEqual({
      kind: 'sherpa',
      exe: 'C:\\sherpa.exe',
      voice: 'C:\\voce.onnx',
    });
    const brokenVoice = [tool('tts', 'C:\\sherpa.exe'), tool('ttsVoice', 'C:\\v.onnx', 'Manca')];
    expect(chooseEngine(brokenVoice, 'win32')).toEqual({ kind: 'windows' });
    expect(() => chooseEngine([], 'linux')).toThrow(/Nessuna voce/);
  });
});

describe('montaggio delle slide', () => {
  it('misura un WAV dall’intestazione', () => {
    expect(wavDurationMs(wav(1500))).toBe(1500);
    expect(() => wavDurationMs(Buffer.from('nope'))).toThrow();
  });

  it('una coppia di ingressi per scena, zoom lento e voce allungata della pausa', () => {
    const scenes = [
      { slide: 'slide-1.jpg', voice: 'voce-1.wav', speechMs: 2000 },
      { slide: 'slide-2.jpg', voice: 'voce-2.wav', speechMs: 1550 },
    ];
    const graph = slideshowGraph(scenes, '#0F1115');
    expect(graph).toContain('[0:v]scale=2160:2700');
    expect(graph).toContain("zoompan=z='min(1+0.000811*on\\,1.06)'");
    expect(graph).toContain('pad=1080:1920:0:190:color=0x0F1115');
    expect(graph).toContain('[3:a]aresample=48000');
    expect(graph).toContain('apad=whole_dur=2.000,atrim=duration=2.000');
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]');
    const args = slideshowArgs({ scenes, graphFile: 'filtri.txt', output: 'video.mp4' });
    expect(args.slice(2, 12)).toEqual([
      '-loop',
      '1',
      '-framerate',
      '30',
      '-t',
      '2.450',
      '-i',
      'slide-1.jpg',
      '-i',
      'voce-1.wav',
    ]);
    expect(ffmpegColor('rosso')).toBe('0x000000');
  });
});

describe('«Crea video dall’idea»', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const script: VideoScript = {
    brandId: 1,
    title: 'Perché uso Rust',
    kicker: 'rust',
    scenes: [
      {
        narration: 'Il bug più costoso? Un puntatore nullo.',
        slide: { kind: 'cover', title: 'Il bug', body: '', code: '' },
      },
      {
        narration: 'Rust ti ferma prima.',
        slide: { kind: 'cta', title: 'Seguimi', body: '', code: '' },
      },
    ],
  };

  function setup(status: ToolsStatus, transcribeFails = false) {
    dir = mkdtempSync(join(tmpdir(), 'prisma-idea-video-'));
    const store = new LocalStore(':memory:', () => new Date('2026-11-24T10:00:00Z'));
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const run: ProcessRunner = async (command, args, options) => {
      calls.push({ command, args });
      if (command === 'powershell.exe') {
        const script = Buffer.from(args[3]!, 'base64').toString('utf16le');
        const out = /SetOutputToWaveFile\('(.+)'\)/.exec(script)![1]!;
        writeFileSync(out, wav(1000));
      }
      if (command === 'ffmpeg') {
        options?.onLine?.('out_time_ms=1000000', 'stdout');
        writeFileSync(args[args.length - 1]!, 'mp4');
      }
      return { code: 0, stderrTail: '' };
    };
    const progress: string[] = [];
    let transcribed = 0;
    const service = createIdeaVideoService({
      store,
      toolsStatus: async () => status,
      requireTool: async (name) => name,
      videosRoot: dir,
      run,
      emit: (p) => progress.push(`${p.projectId}:${p.stage}`),
      captureSlide: async () => Buffer.from('jpg'),
      fontFaceCss: async () => '',
      probe: async (_ffprobe, path) => ({
        path,
        fileName: 'video.mp4',
        sizeBytes: 3,
        durationMs: 2900,
        width: 1080,
        height: 1920,
        fps: 30,
        videoCodec: 'h264',
        hasAudio: true,
      }),
      transcribe: async (id) => {
        transcribed++;
        if (transcribeFails) throw new Error('whisper rotto');
        // Whisper capisce «buco» al posto di «bug».
        const project = store.getProject(id)!;
        const words = project.transcript!.words.map((w) =>
          w.text === 'bug' ? { ...w, text: 'buco', startMs: w.startMs + 5 } : w,
        );
        const heard = {
          ...project,
          transcript: { ...project.transcript!, model: 'ggml-small.bin', words },
        };
        store.updateProject(heard);
        return heard;
      },
      codePage: async () => 1252,
      platform: 'win32',
      pickMusic: async () => ({
        path: 'C:\\Musica\\lofi.mp3',
        fileName: 'lofi.mp3',
        durationMs: 90_000,
      }),
    });
    return { service, store, calls, progress, transcribed: () => transcribed };
  }

  const request = (jobId: string) => ({
    jobId,
    script,
    source: { kind: 'idea' as const, id: 7 },
    template: 'scuro' as const,
    kit: DEFAULT_BRAND_KIT,
    initials: 'MR',
  });

  it('legge le scene, disegna le slide, monta e crea il progetto con la trascrizione stimata', async () => {
    const { service, store, calls, progress, transcribed } = setup([]);
    const jobId = '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f';
    const project = await service.generate(request(jobId));

    expect(calls.filter((c) => c.command === 'powershell.exe')).toHaveLength(2);
    const ffmpeg = calls.find((c) => c.command === 'ffmpeg')!;
    expect(ffmpeg.args).toContain('slide-2.jpg');
    expect(project).toMatchObject({
      title: 'Perché uso Rust',
      edit: {
        format: '9:16',
        subtitles: 'word',
        audio: {
          clean: true,
          normalize: true,
          music: { fileName: 'lofi.mp3', volumeDb: -10, ducking: true },
        },
      },
      generated: { source: 'idea', sourceId: 7, voice: 'Voce di Windows', scenes: 2 },
    });
    // La seconda scena parte dopo 1 s di voce e la pausa.
    const words = project.transcript!.words;
    expect(words[0]).toMatchObject({ text: 'Il', startMs: 0 });
    expect(words.find((w) => w.text === 'Rust')!.startMs).toBe(1450);
    expect(store.listProjects()).toHaveLength(1);
    expect(progress).toContain(`${jobId}:montaggio`);
    expect(transcribed()).toBe(0);
    // Resta solo il video: i file di lavoro si cancellano.
    expect(existsSync(join(dir!, jobId, 'video.mp4'))).toBe(true);
    expect(existsSync(join(dir!, jobId, 'lavoro'))).toBe(false);
  });

  it('con whisper.cpp tiene il testo del copione con i tempi sentiti', async () => {
    const status = [tool('whisper', 'w.exe'), tool('whisperModel', 'm.bin')];
    const { service, store } = setup(status);
    const project = await service.generate(request('3b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f'));
    expect(project.transcript?.model).toBe('ggml-small.bin');
    const bug = project.transcript!.words[1]!;
    expect(bug.text).toBe('bug');
    expect(store.getProject(project.id)!.transcript!.words[1]!.startMs).toBe(bug.startMs);
  });

  it('con whisper.cpp trascrive; se fallisce tiene la stima', async () => {
    const status = [tool('whisper', 'w.exe'), tool('whisperModel', 'm.bin')];
    const { service, transcribed } = setup(status, true);
    const project = await service.generate(request('1b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f'));
    expect(transcribed()).toBe(1);
    expect(project.transcript?.model).toBe('copione');
  });

  it('se FFmpeg fallisce non lascia file a metà', async () => {
    const { service, store } = setup([]);
    const jobId = '2b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f';
    const failing = createIdeaVideoService({
      store,
      toolsStatus: async () => [],
      requireTool: async (name) => name,
      videosRoot: dir!,
      run: async (command, args) => {
        if (command === 'powershell.exe') {
          const out = /SetOutputToWaveFile\('(.+)'\)/.exec(
            Buffer.from(args[3]!, 'base64').toString('utf16le'),
          )![1]!;
          writeFileSync(out, wav(500));
          return { code: 0, stderrTail: '' };
        }
        return { code: 1, stderrTail: 'Invalid argument' };
      },
      emit: () => {},
      captureSlide: async () => Buffer.from('jpg'),
      fontFaceCss: async () => '',
      probe: async () => {
        throw new Error('non chiamato');
      },
      transcribe: async () => {
        throw new Error('non chiamato');
      },
      codePage: async () => null,
      platform: 'win32',
    });
    void service;
    await expect(failing.generate(request(jobId))).rejects.toThrow(/Invalid argument/);
    expect(existsSync(join(dir!, jobId))).toBe(false);
    expect(store.listProjects()).toHaveLength(0);
  });
});
