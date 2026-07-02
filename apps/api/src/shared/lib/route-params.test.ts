import { describe, expect, it } from "bun:test";
import { parseTagIds } from "./route-params";

describe("parseTagIds", () => {
  it("returns [] for missing or empty input", () => {
    expect(parseTagIds(undefined)).toEqual([]);
    expect(parseTagIds([])).toEqual([]);
  });

  it("accepts repeated params", () => {
    expect(parseTagIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("splits comma-separated values and trims whitespace", () => {
    expect(parseTagIds(["a, b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(parseTagIds(["a,b", "b,a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("drops blank fragments", () => {
    expect(parseTagIds(["a,,  ,b"])).toEqual(["a", "b"]);
  });

  it("caps the result at 50 ids", () => {
    const raw = Array.from({ length: 60 }, (_, i) => `t${i}`);
    expect(parseTagIds(raw)).toHaveLength(50);
  });
});
