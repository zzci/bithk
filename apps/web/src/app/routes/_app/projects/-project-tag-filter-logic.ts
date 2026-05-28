// Pure layout math for the responsive tag filter. Kept DOM-free so it can be
// unit-tested without a layout engine (jsdom does no layout).

export interface TagFitInput {
  // Chip widths in render order (the API returns tags most-used first).
  readonly widths: readonly number[];
  // Content width of the row the chips live in.
  readonly available: number;
  // Width of the overflow ("More") trigger, reserved when chips overflow.
  readonly moreWidth: number;
  // Gap between adjacent items (matches the row's flex gap).
  readonly gap: number;
}

/**
 * Number of leading tag chips that fit inline before the overflow control.
 *
 * - Returns `widths.length` when every chip fits without an overflow control.
 * - Otherwise reserves room for the "More" trigger and keeps at least one chip
 *   visible (so a very narrow row still shows a single chip plus the control).
 */
export function computeVisibleTagCount({ widths, available, moreWidth, gap }: TagFitInput): number {
  if (widths.length === 0)
    return 0;

  const fit = (reserve: number): number => {
    let used = 0;
    let n = 0;
    for (const w of widths) {
      const add = (n > 0 ? gap : 0) + w;
      const reserveSpace = reserve > 0 ? gap + reserve : 0;
      if (used + add + reserveSpace <= available) {
        used += add;
        n += 1;
      }
      else {
        break;
      }
    }
    return n;
  };

  // Everything fits with no overflow control needed.
  if (fit(0) >= widths.length)
    return widths.length;
  // Overflow: reserve room for the trigger, but never hide every chip.
  return Math.max(1, fit(moreWidth));
}
