import { describe, expect, test } from "bun:test";
import { ulid, ulidTimeMs } from "./id";

describe("ulidTimeMs", () => {
  test("decodes the mint timestamp of a freshly minted ULID", () => {
    const before = Date.now();
    const id = ulid();
    const after = Date.now();
    const ts = ulidTimeMs(id);
    expect(ts).not.toBeNull();
    // The monotonic generator may reuse/advance the last ms slightly, so
    // allow a small window around the mint instant.
    expect(ts!).toBeGreaterThanOrEqual(before - 5);
    expect(ts!).toBeLessThanOrEqual(after + 5);
  });

  test("returns null for non-ULID ids", () => {
    expect(ulidTimeMs("nanoid8x")).toBeNull(); // wrong length
    expect(ulidTimeMs("i".repeat(26))).toBeNull(); // 'i' not in the alphabet
    expect(ulidTimeMs("")).toBeNull();
    expect(ulidTimeMs(`${"0".repeat(25)}I`)).toBeNull(); // uppercase tail
  });

  test("orders by time: a later ULID decodes to a later-or-equal timestamp", () => {
    const a = ulid();
    const b = ulid();
    expect(ulidTimeMs(b)!).toBeGreaterThanOrEqual(ulidTimeMs(a)!);
  });
});
