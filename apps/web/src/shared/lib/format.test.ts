import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("reports raw bytes below 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales through the unit ladder with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("drops the decimal at or above 10 units", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KB");
  });

  it("caps at the largest unit (TB)", () => {
    expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 TB");
  });
});
