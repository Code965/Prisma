import { describe, expect, it } from 'vitest';
import { runProcess } from './process.js';

describe('runProcess', () => {
  it('passa le righe di stdout e stderr man mano e restituisce il codice', async () => {
    const lines: string[] = [];
    const script =
      "process.stdout.write('uno\\ndue\\n'); process.stderr.write('progress =  50%\\r\\n'); process.exit(3)";
    const result = await runProcess(process.execPath, ['-e', script], {
      onLine: (line, stream) => lines.push(`${stream}:${line}`),
    });
    expect(result.code).toBe(3);
    expect(lines).toEqual(['stdout:uno', 'stdout:due', 'stderr:progress =  50%']);
    expect(result.stderrTail).toContain('progress =  50%');
  });

  it('non interpreta gli argomenti con una shell', async () => {
    const lines: string[] = [];
    await runProcess(
      process.execPath,
      ['-e', 'console.log(process.argv[1])', 'a & echo pericolo'],
      {
        onLine: (line) => lines.push(line),
      },
    );
    expect(lines).toEqual(['a & echo pericolo']);
  });
});
