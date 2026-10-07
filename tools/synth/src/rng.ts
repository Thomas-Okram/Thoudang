/**
 * Seeded PRNG (mulberry32) with labelled sub-streams, so the synthetic set is reproducible with
 * `--seed` and adding a draw in one place does not reshuffle every packet after it.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  int(min: number, maxInclusive: number): number;
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T extends string>(weights: Readonly<Record<T, number>>): T;
  shuffle<T>(items: readonly T[]): T[];
  /** Independent stream derived from this seed + label. */
  fork(label: string): Rng;
  readonly seed: number;
}

/** FNV-1a 32-bit — stable string → seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed: seed >>> 0,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (!items.length) throw new Error('pick() from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (weights) => {
      const entries = Object.entries(weights) as [string, number][];
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [k, w] of entries) {
        r -= w;
        if (r < 0) return k as never;
      }
      return entries[entries.length - 1]![0] as never;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    fork: (label) => createRng(hashString(`${seed >>> 0}:${label}`)),
  };
  return rng;
}
