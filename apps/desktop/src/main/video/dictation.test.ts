import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDictationService, dictationText } from './dictation.js';
import type { ProcessRunner } from './process.js';

const token = (text: string, from: number) => ({ text, offsets: { from, to: from + 200 }, p: 0.9 });

describe('dettatura', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('ricompone il testo con la punteggiatura attaccata', () => {
    expect(
      dictationText([{ text: 'Spiegare' }, { text: 'perché' }, { text: ',' }, { text: 'Rust.' }]),
    ).toBe('Spiegare perché, Rust.');
    expect(dictationText([{ text: '«ciao' }, { text: '»' }])).toBe('«ciao»');
    expect(dictationText([])).toBe('');
  });

  it('converte la registrazione, la trascrive e cancella i file di lavoro', async () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-dettatura-'));
    const workRoot = join(dir, 'lavoro');
    const calls: string[][] = [];
    const run: ProcessRunner = async (command, args) => {
      calls.push([command, ...args]);
      if (command.endsWith('whisper.exe')) {
        const base = args[args.indexOf('-of') + 1]!;
        writeFileSync(
          `${base}.json`,
          JSON.stringify({
            result: { language: 'it' },
            transcription: [
              {
                tokens: [
                  token('[_BEG_]', 0),
                  token(' Un', 0),
                  token(' video', 300),
                  token('.', 600),
                ],
              },
            ],
          }),
        );
      }
      return { code: 0, stderrTail: '' };
    };
    const service = createDictationService({
      requireTool: async (tool) => `C:/tools/${tool}.exe`,
      workRoot,
      run,
      threads: 2,
    });
    const result = await service.transcribe(new Uint8Array([1, 2, 3]), 'auto');
    expect(result).toEqual({ text: 'Un video.', language: 'it' });
    expect(calls[0]![0]).toBe('C:/tools/ffmpeg.exe');
    expect(calls[1]).toEqual(expect.arrayContaining(['-l', 'auto', '-t', '2']));
    expect(existsSync(workRoot) ? readdirSync(workRoot) : []).toEqual([]);
  });

  it('riporta l’errore di FFmpeg', async () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-dettatura-'));
    const service = createDictationService({
      requireTool: async (tool) => tool,
      workRoot: dir,
      run: async () => ({ code: 1, stderrTail: 'Invalid data found' }),
    });
    await expect(service.transcribe(new Uint8Array([1]), 'it')).rejects.toThrow(
      'FFmpeg non ha letto la registrazione: Invalid data found',
    );
  });
});
