import { describe, expect, it } from "vitest";
import { pinnedFitCount } from "./-project-tag-filter.fit";

// Defaults: max 5, chipWidth 88, selectorWidth 64, gap 8.
// usable = width - selectorWidth - gap = width - 72.
// chips: first 88, each next +8+88=96. So n chips need 88 + 96*(n-1) <= usable.
describe("pinnedFitCount", () => {
  it("returns 0 for an unmeasured width", () => {
    expect(pinnedFitCount(0, 8)).toBe(0);
  });

  it("returns 0 for a non-finite width", () => {
    expect(pinnedFitCount(Number.NaN, 8)).toBe(0);
  });

  it("returns 0 when the width cannot fit a single chip plus the selector", () => {
    // usable = 50 - 72 < 0.
    expect(pinnedFitCount(50, 8)).toBe(0);
  });

  it("caps at the max (5) when the row is wide", () => {
    expect(pinnedFitCount(2000, 8)).toBe(5);
  });

  it("clamps to the tag count when fewer than max tags exist", () => {
    expect(pinnedFitCount(2000, 3)).toBe(3);
  });

  it("returns 0 for zero tags regardless of width", () => {
    expect(pinnedFitCount(2000, 0)).toBe(0);
  });

  it("reserves room for the selector when chips overflow", () => {
    // usable = 500 - 72 = 428. 5 chips need 88 + 96*4 = 472 > 428 -> 4 fit.
    expect(pinnedFitCount(500, 8)).toBe(4);
  });

  it("fits exactly the max at its threshold width", () => {
    // 5 chips need usable >= 472 -> width >= 544.
    expect(pinnedFitCount(544, 8)).toBe(5);
    expect(pinnedFitCount(543, 8)).toBe(4);
  });

  it("honors custom chip/selector/gap estimates", () => {
    // usable = 300 - 50 - 10 = 240. chips of 100: first 100, next +110.
    // 100 <= 240 -> 1; 210 <= 240 -> 2; 320 > 240 -> stop => 2.
    expect(pinnedFitCount(300, 8, { chipWidth: 100, selectorWidth: 50, gap: 10 })).toBe(2);
  });
});
