export type Probe = { size: number };

export type SearchOpts = {
  /** Start here (e.g. the previous page's answer); similar pages then need 2–4 encodes. */
  hint?: number;
  /** Accept an answer within this many quality steps of the true maximum. */
  tolerance?: number;
};

/**
 * Find the highest integer quality in [lo, hi] whose output fits under `max`.
 * Assumes size grows with quality. Returns the smallest attempt if even `lo` is too big.
 */
export async function searchQuality<T extends Probe>(
  encode: (q: number) => Promise<T>,
  lo: number,
  hi: number,
  max: number,
  opts: SearchOpts = {},
): Promise<{ q: number; out: T } | { q: null; smallest: T }> {
  const tol = Math.max(1, opts.tolerance ?? 1);
  let best: { q: number; out: T } | null = null;
  let smallest: T | null = null;
  const tried = new Set<number>();
  const tryQ = async (q: number) => {
    tried.add(q);
    const out = await encode(q);
    if (out.size <= max) {
      if (!best || q > best.q) best = { q, out };
      return true;
    }
    if (!smallest || out.size < smallest.size) smallest = out;
    return false;
  };

  let a = lo;
  let b = hi;
  const hint = opts.hint;
  if (hint !== undefined && hint > lo && hint < hi) {
    if (await tryQ(hint)) a = hint + 1;
    else b = hint - 1;
  } else {
    if (await tryQ(hi)) return best!;
    b = hi - 1;
  }
  // Fail fast when even the floor is too big.
  if (!best && !tried.has(lo) && !(await tryQ(lo))) return { q: null, smallest: smallest! };
  if (best && (best as { q: number }).q === lo) a = lo + 1;

  while (a <= b) {
    if (best && b - a + 1 < tol) break;
    const mid = (a + b) >> 1;
    if (await tryQ(mid)) a = mid + 1;
    else b = mid - 1;
  }
  return best ?? { q: null, smallest: smallest! };
}
