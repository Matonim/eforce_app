// Seeded PRNG (mulberry32). The whole generator state is one uint32 stored on a plain
// object (normally the match), so a JSON snapshot resumes the exact same random sequence.

export function hashSeed(seed) {
  // FNV-1a, 32-bit: turns any string/number seed into a uint32.
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {Record<string, any>} holder object that owns the state, e.g. the match
 * @param {string} key property on holder that stores the uint32 state
 */
export function createRng(holder, key = 'rngState') {
  const next = () => {
    let t = (holder[key] = (holder[key] + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    /** float in [0, 1) */
    next,
    /** integer in [min, max], inclusive */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    /** items: array, weightOf: item => non-negative number. Returns undefined if all weights are 0. */
    weighted(items, weightOf) {
      const total = items.reduce((sum, it) => sum + Math.max(0, weightOf(it)), 0);
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (const it of items) {
        roll -= Math.max(0, weightOf(it));
        if (roll < 0) return it;
      }
      return items[items.length - 1];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}
