// Deterministic seeded RNG so the same inputs always produce the same
// output (critical for reproducible tests and the offline mock provider).

export function hashString(input: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  intBetween(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  pickMany<T>(items: readonly T[], count: number): T[];
  bool(chance?: number): boolean;
}

export function createRng(seed: string | number): Rng {
  let s = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0;
  if (s === 0) s = 0x9e3779b9;

  const next = (): number => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);

  return {
    next,
    int,
    intBetween: (min, max) => min + int(max - min + 1),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from empty array');
      return items[int(items.length)] as T;
    },
    pickMany: <T>(items: readonly T[], count: number): T[] => {
      const pool = [...items];
      const out: T[] = [];
      for (let i = 0; i < count && pool.length > 0; i++) {
        out.push(...pool.splice(int(pool.length), 1));
      }
      return out;
    },
    bool: (chance = 0.5) => next() < chance,
  };
}
