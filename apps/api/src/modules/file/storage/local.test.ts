import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { deriveStorageKey } from "./key";
import { __setLocalDriverRootForTests, localDriver } from "./local";

let root: string;

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "file-local-"));
  __setLocalDriverRootForTests(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

describe("deriveStorageKey", () => {
  test("fans a sha256 into <ab>/<cd>/<sha>", () => {
    const sha = "a".repeat(64);
    expect(deriveStorageKey(sha)).toBe(`aa/aa/${sha}`);
  });

  test("rejects a non-hex / wrong-length digest", () => {
    expect(() => deriveStorageKey("short")).toThrow(/Invalid sha256/);
    expect(() => deriveStorageKey("Z".repeat(64))).toThrow(/Invalid sha256/);
    expect(() => deriveStorageKey(`${"a".repeat(63)}/`)).toThrow(/Invalid sha256/);
  });
});

describe("local driver path-traversal defence", () => {
  // Each malicious key must be rejected by every byte-touching method so a
  // future caller bug cannot read or write outside FILE_STORAGE_LOCAL_ROOT.
  const evilKeys = [
    "../escape",
    "../../etc/passwd",
    "ab/../../escape",
    "ab\\..\\..\\escape",
    "/etc/passwd",
  ];

  for (const key of evilKeys) {
    test(`put refuses ${JSON.stringify(key)}`, async () => {
      await expect(localDriver.put(key, bytes("x"))).rejects.toThrow(/Invalid storage key/);
    });
    test(`getStream refuses ${JSON.stringify(key)}`, async () => {
      await expect(localDriver.getStream(key)).rejects.toThrow(/Invalid storage key/);
    });
    test(`delete refuses ${JSON.stringify(key)}`, async () => {
      await expect(localDriver.delete(key)).rejects.toThrow(/Invalid storage key/);
    });
    test(`exists refuses ${JSON.stringify(key)}`, async () => {
      await expect(localDriver.exists(key)).rejects.toThrow(/Invalid storage key/);
    });
  }

  test("a traversal write does not escape the root", async () => {
    await expect(localDriver.put("../../pwned", bytes("danger"))).rejects.toThrow();
    // Nothing was created above the root.
    expect(existsSync(resolve(root, "..", "pwned"))).toBe(false);
    expect(existsSync(resolve(root, "..", "..", "pwned"))).toBe(false);
  });
});

describe("local driver round-trip", () => {
  test("put then getStream returns the same bytes under the keyed path", async () => {
    const key = deriveStorageKey("b".repeat(64));
    await localDriver.put(key, bytes("hello blob"));

    // Landed at <root>/bb/bb/<sha> and nowhere else.
    expect(existsSync(resolve(root, key))).toBe(true);

    const stream = await localDriver.getStream(key);
    const text = await new Response(stream).text();
    expect(text).toBe("hello blob");
    expect(await localDriver.exists(key)).toBe(true);
  });

  test("put is two-phase: no leftover .tmp file remains", async () => {
    const key = deriveStorageKey("c".repeat(64));
    await localDriver.put(key, bytes("data"));
    const dir = resolve(root, "cc", "cc");
    const leftovers = readdirSync(dir).filter(name => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  test("getStream throws for a missing blob", async () => {
    const key = deriveStorageKey("d".repeat(64));
    await expect(localDriver.getStream(key)).rejects.toThrow(/Missing blob/);
  });

  test("delete is tolerant of a missing key (idempotent)", async () => {
    const key = deriveStorageKey("e".repeat(64));
    await expect(localDriver.delete(key)).resolves.toBeUndefined();
    // And after a real write, delete removes it and a second delete is a no-op.
    await localDriver.put(key, bytes("bye"));
    await localDriver.delete(key);
    expect(await localDriver.exists(key)).toBe(false);
    await expect(localDriver.delete(key)).resolves.toBeUndefined();
  });
});
