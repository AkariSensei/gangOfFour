import type { Card, Color } from '../src';

const colors: Record<string, Color> = { g: 'green', y: 'yellow', r: 'red', m: 'multi' };

/** Fabrique des cartes à partir d'une notation courte : "g5", "r10", "m1", "gP", "yP", "rD". */
export function cards(...codes: string[]): Card[] {
  return codes.map((code, i) => {
    const color = colors[code[0]!]!;
    const rest = code.slice(1);
    const value = rest === 'P' ? 11 : rest === 'D' ? 12 : Number(rest);
    return { id: `${code}-${i}`, value, color };
  });
}
