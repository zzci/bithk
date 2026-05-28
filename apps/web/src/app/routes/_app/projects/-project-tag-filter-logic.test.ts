import { describe, expect, it } from "vitest";
import { computeVisibleTagCount } from "./-project-tag-filter-logic";

describe("computeVisibleTagCount", () => {
  it("returns 0 for no chips", () => {
    expect(computeVisibleTagCount({ widths: [], available: 500, moreWidth: 40, gap: 8 })).toBe(0);
  });

  it("shows every chip when they all fit without an overflow control", () => {
    // 3 chips of 100 + 2 gaps of 8 = 316 <= 500.
    expect(computeVisibleTagCount({ widths: [100, 100, 100], available: 500, moreWidth: 40, gap: 8 })).toBe(3);
  });

  it("reserves room for the More trigger when chips overflow", () => {
    // available 250, more 40, gap 8.
    // chip0: 100 (+ 8+40 reserve = 148) = 148 <= 250 -> keep
    // chip1: 100+8 (+ 48 reserve) = 256 > 250 -> stop. => 1 inline.
    expect(computeVisibleTagCount({ widths: [100, 100, 100], available: 250, moreWidth: 40, gap: 8 })).toBe(1);
  });

  it("fits two chips plus the trigger when there is room", () => {
    // available 300: all three need 316 (fit(0) -> 2, so overflow). With the
    // trigger reserved: chip0 100(+48)=148; chip1 +108=256<=300; chip2 +108=364>300 => 2.
    expect(computeVisibleTagCount({ widths: [100, 100, 100], available: 300, moreWidth: 40, gap: 8 })).toBe(2);
  });

  it("keeps at least one chip even when nothing fits", () => {
    expect(computeVisibleTagCount({ widths: [100, 100], available: 10, moreWidth: 40, gap: 8 })).toBe(1);
  });
});
