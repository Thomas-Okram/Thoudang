// Verhoeff checksum (dihedral group D5). Used by UIDAI for the Aadhaar check digit.
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

function lookup(table: readonly (readonly number[])[], row: number, col: number): number {
  const value = table[row]?.[col];
  if (value === undefined) throw new Error('Verhoeff table index out of range');
  return value;
}

function checksum(digits: string, offset: number): number {
  let c = 0;
  const reversed = [...digits].reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = lookup(D, c, lookup(P, (i + offset) % 8, Number(reversed[i])));
  }
  return c;
}

const DIGITS = /^\d+$/;

/** Check digit to append to `digits`. */
export function verhoeffCheckDigit(digits: string): string {
  if (!DIGITS.test(digits)) throw new Error('Verhoeff input must be digits only');
  return String(INV[checksum(digits, 1)]);
}

/** True when `digits` (including its trailing check digit) passes the Verhoeff check. */
export function verhoeffValidate(digits: string): boolean {
  if (!DIGITS.test(digits)) return false;
  return checksum(digits, 0) === 0;
}
