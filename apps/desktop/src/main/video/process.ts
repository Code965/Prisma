import { spawn } from 'node:child_process';

export interface ProcessOptions {
  /** Ogni riga di stdout e stderr, appena arriva (per l'avanzamento). */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  signal?: AbortSignal;
  /** Cartella di lavoro del processo (i file relativi si cercano qui). */
  cwd?: string;
}

export interface ProcessResult {
  code: number | null;
  /** Ultime righe di stderr, per spiegare un errore. */
  stderrTail: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessOptions,
) => Promise<ProcessResult>;

/** Avvia un programma senza shell (gli argomenti non vengono mai interpretati) e ne legge le righe. */
export const runProcess: ProcessRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
      cwd: options.cwd,
    });
    const tail: string[] = [];
    const reader = (stream: 'stdout' | 'stderr') => {
      let buffer = '';
      return (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (stream === 'stderr') {
            tail.push(line);
            if (tail.length > 20) tail.shift();
          }
          options.onLine?.(line, stream);
        }
      };
    };
    child.stdout.on('data', reader('stdout'));
    child.stderr.on('data', reader('stderr'));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderrTail: tail.join('\n') }));
  });
