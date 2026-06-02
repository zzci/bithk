// Pure layout math for the responsive pinned tag chips. Kept DOM-free so it can
// be unit-tested without a layout engine (jsdom does no layout).
//
// The pinned chips have variable width (tag names differ), so this uses a fixed
// per-chip estimate rather than real measurements. That is enough to decide how
// many of the top-N chips fit before the always-present "Tags" selector — when
// the row narrows we drop the least-used pinned chips into the selector.

export interface PinnedFitOptions {
  // Hard cap on pinned chips (most-used first). Defaults to PINNED_COUNT.
  readonly max?: number;
  // Estimated rendered width of one pinned chip.
  readonly chipWidth?: number;
  // Width reserved for the always-present selector trigger.
  readonly selectorWidth?: number;
  // Gap between adjacent items (matches the row's flex gap).
  readonly gap?: number;
}

const DEFAULTS: Required<PinnedFitOptions> = {
  max: 5,
  chipWidth: 88,
  selectorWidth: 64,
  gap: 8,
};

/**
 * How many of the top-N pinned chips fit a measured container width.
 *
 * - Always reserves room for the selector trigger (+ a gap before it).
 * - Returns 0 for a non-positive/unmeasured width or when nothing fits.
 * - Result is clamped to `[0, min(max, tagCount)]`.
 */
export function pinnedFitCount(width: number, tagCount: number, options: PinnedFitOptions = {}): number {
  const { max, chipWidth, selectorWidth, gap } = { ...DEFAULTS, ...options };

  const cap = Math.min(max, Math.max(0, tagCount));
  if (cap <= 0)
    return 0;
  if (!Number.isFinite(width) || width <= 0)
    return 0;

  // Subtract the selector trigger (and the gap before it) up front.
  const usable = width - selectorWidth - gap;
  if (usable <= 0)
    return 0;

  let used = 0;
  let n = 0;
  for (let i = 0; i < cap; i += 1) {
    const add = (n > 0 ? gap : 0) + chipWidth;
    if (used + add <= usable) {
      used += add;
      n += 1;
    }
    else {
      break;
    }
  }
  return n;
}
