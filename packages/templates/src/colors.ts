/** Mescola due colori #RRGGBB: `weight` è la quota del primo (0–1). */
export function mixHex(a: string, b: string, weight: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const channel = (i: number) => Math.round(ca[i]! * weight + cb[i]! * (1 - weight));
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function parseHex(hex: string): number[] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Colore non valido: ${hex}`);
  return match.slice(1).map((part) => parseInt(part, 16));
}

/** `#RRGGBB` con trasparenza, come `rgba(…)`. */
export function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 1000) / 1000})`;
}
