import { execFile } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ProcessRunner } from './process.js';

const execFileAsync = promisify(execFile);

/**
 * Voce locale per «Crea video dall'idea» (fase 6c).
 *
 * - **sherpa-onnx** (`sherpa-onnx-offline-tts.exe`, release 1.13: la 2.x ha tolto espeak-ng, che
 *   serve alle voci Piper) con una voce Piper (`.onnx`, `tokens.txt`, `espeak-ng-data`).
 * - **Voce di Windows** (System.Speech da PowerShell) come ripiego: c'è sempre, suona più
 *   robotica.
 */
export type SpeechEngine = { kind: 'sherpa'; exe: string; voice: string } | { kind: 'windows' };

export function engineLabel(engine: SpeechEngine): string {
  return engine.kind === 'sherpa'
    ? `Voce Piper ${basename(engine.voice).replace(/\.onnx$/i, '')}`
    : 'Voce di Windows';
}

/**
 * sherpa-onnx legge gli argomenti con la code page ANSI di Windows, non in UTF-8: «perché»
 * arriverebbe storpiato. Si passano allora i byte UTF-8 come se fossero caratteri della code page
 * (TextDecoder): Windows li riconverte negli stessi byte e il programma legge UTF-8 corretto.
 * Il testo deve passare prima da `speechText`, che tiene solo caratteri sicuri.
 */
export function ansiArgument(text: string, codePage: number | null): string {
  if (!codePage || codePage === 65001) return text;
  try {
    return new TextDecoder(`windows-${codePage}`).decode(Buffer.from(text, 'utf8'));
  } catch {
    return text;
  }
}

/** Code page ANSI del sistema (1252 sui Windows italiani), dal registro. */
export async function readAnsiCodePage(): Promise<number | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'],
      { windowsHide: true, timeout: 5000 },
    );
    const match = /ACP\s+REG_SZ\s+(\d+)/.exec(stdout);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function sherpaArgs(options: {
  voice: string;
  output: string;
  text: string;
  threads: number;
  codePage: number | null;
}): string[] {
  const dir = dirname(options.voice);
  return [
    `--vits-model=${options.voice}`,
    `--vits-tokens=${join(dir, 'tokens.txt')}`,
    `--vits-data-dir=${join(dir, 'espeak-ng-data')}`,
    `--num-threads=${options.threads}`,
    `--output-filename=${options.output}`,
    ansiArgument(options.text, options.codePage),
  ];
}

const psString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Script PowerShell per la voce di Windows: legge il testo da un file UTF-8 (niente problemi di
 * codifica sulla riga di comando), sceglie una voce italiana se c'è e scrive un WAV.
 */
export function windowsSpeechScript(textFile: string, output: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'it-IT' } | Select-Object -First 1",
    'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }',
    `$s.SetOutputToWaveFile(${psString(output)})`,
    `$s.Speak([IO.File]::ReadAllText(${psString(textFile)}, [Text.Encoding]::UTF8))`,
    '$s.Dispose()',
  ].join('\n');
}

/** `-EncodedCommand`: lo script in UTF-16 base64, così i percorsi non si rovinano. */
export function powershellArgs(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

export interface SpeakDeps {
  run: ProcessRunner;
  writeText: (path: string, text: string) => Promise<void>;
  codePage: number | null;
  threads: number;
  signal?: AbortSignal;
}

/** Legge il testo (già passato da `speechText`) e scrive un WAV. */
export async function speak(
  engine: SpeechEngine,
  text: string,
  output: string,
  deps: SpeakDeps,
): Promise<void> {
  if (engine.kind === 'sherpa') {
    const result = await deps.run(
      engine.exe,
      sherpaArgs({
        voice: engine.voice,
        output,
        text,
        threads: deps.threads,
        codePage: deps.codePage,
      }),
      { signal: deps.signal },
    );
    if (result.code !== 0) {
      throw new Error(`sherpa-onnx non ha letto il testo: ${lastLine(result.stderrTail)}`);
    }
    return;
  }
  const textFile = `${output}.txt`;
  await deps.writeText(textFile, text);
  const result = await deps.run(
    'powershell.exe',
    powershellArgs(windowsSpeechScript(textFile, output)),
    {
      signal: deps.signal,
    },
  );
  if (result.code !== 0) {
    throw new Error(`La voce di Windows non ha letto il testo: ${lastLine(result.stderrTail)}`);
  }
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? 'errore sconosciuto').slice(0, 300);
}
