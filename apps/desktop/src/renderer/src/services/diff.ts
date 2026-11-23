export interface DiffLine {
  kind: 'same' | 'del' | 'add';
  text: string;
}

/**
 * Diff riga per riga (sottosequenza comune più lunga). Per i testi dei post bastano poche
 * decine di righe, quindi l'algoritmo quadratico è più che sufficiente.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ kind: 'del', text: a[i++]! });
    } else {
      result.push({ kind: 'add', text: b[j++]! });
    }
  }
  while (i < a.length) result.push({ kind: 'del', text: a[i++]! });
  while (j < b.length) result.push({ kind: 'add', text: b[j++]! });
  return result;
}

/** Solo le righe cambiate (non vuote), come nel riquadro del mockup: "− prima" / "+ dopo". */
export function changedLines(before: string, after: string, limit = 6): DiffLine[] {
  return diffLines(before, after)
    .filter((line) => line.kind !== 'same' && line.text.trim() !== '')
    .slice(0, limit);
}
