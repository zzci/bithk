import type { FileStorageDriver } from "./storage/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { getThumbnail, parseThumbnailWidth, previewCacheEnabled } from "./preview-cache";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "./storage/registry";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// A real JPEG from the seed assets so Bun.Image can actually decode + resize it.
const SAMPLE = resolve(import.meta.dir, "../../../scripts/seed/assets/attachments/equipment-photo.jpg");

let cacheDir: string;
let throwOnRead = false;

const fakeImageDriver: FileStorageDriver = {
  name: "fake-image",
  async put() {},
  async getStream() {
    if (throwOnRead)
      throw new Error("source unavailable — must be served from cache");
    return Bun.file(SAMPLE).stream();
  },
  async delete() {},
  async exists() {
    return true;
  },
};

const sha = "a".repeat(64);
const storageKey = `${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;

function cfg() {
  return { FILE_PREVIEW_CACHE_ENABLED: undefined, FILE_PREVIEW_CACHE_DIR: cacheDir } as const;
}

beforeEach(() => {
  cacheDir = resolve(tmpdir(), `test-preview-cache-${Date.now()}-${nanoid()}`);
  mkdirSync(cacheDir, { recursive: true });
  throwOnRead = false;
  __resetDriverRegistryForTests();
  registerDriver(fakeImageDriver);
  setActiveDriver("fake-image");
});

afterEach(() => {
  if (existsSync(cacheDir))
    rmSync(cacheDir, { recursive: true, force: true });
});

describe("parseThumbnailWidth", () => {
  test("accepts whitelisted widths and rejects others", () => {
    expect(parseThumbnailWidth("320")).toBe(320);
    expect(parseThumbnailWidth("999")).toBeUndefined();
    expect(parseThumbnailWidth(undefined)).toBeUndefined();
    expect(parseThumbnailWidth("")).toBeUndefined();
  });
});

describe("previewCacheEnabled", () => {
  test("defaults on; off only when explicitly 'false'", () => {
    expect(previewCacheEnabled({ FILE_PREVIEW_CACHE_ENABLED: undefined, FILE_PREVIEW_CACHE_DIR: undefined })).toBe(true);
    expect(previewCacheEnabled({ FILE_PREVIEW_CACHE_ENABLED: "false", FILE_PREVIEW_CACHE_DIR: undefined })).toBe(false);
  });
});

describe("getThumbnail", () => {
  test("generates a WebP thumbnail and serves the second call from cache", async () => {
    const first = await getThumbnail(cfg(), { sha256: sha, storageKey }, 320);
    expect(first).not.toBeNull();
    // WebP container magic: "RIFF"...."WEBP".
    const head = new TextDecoder().decode(first!.slice(0, 4));
    const fmt = new TextDecoder().decode(first!.slice(8, 12));
    expect(head).toBe("RIFF");
    expect(fmt).toBe("WEBP");
    // Far smaller than the ~108 KB source.
    expect(first!.byteLength).toBeLessThan(30_000);

    // The cached file exists, and a second call works even when the source
    // backend is unavailable — proving it was served from cache.
    throwOnRead = true;
    const second = await getThumbnail(cfg(), { sha256: sha, storageKey }, 320);
    expect(second).not.toBeNull();
    expect(second!.byteLength).toBe(first!.byteLength);
  });

  test("returns null for non-image bytes so the caller can fall back", async () => {
    const before = throwOnRead;
    throwOnRead = false;
    // Point at a key whose stream yields the JPEG but request decoding of a
    // tiny bogus width is fine; instead simulate a decode failure by using a
    // driver that streams non-image bytes.
    __resetDriverRegistryForTests();
    registerDriver({
      name: "fake-image",
      async put() {},
      async getStream() {
        return new Response("not an image").body!;
      },
      async delete() {},
      async exists() {
        return true;
      },
    });
    setActiveDriver("fake-image");
    const result = await getThumbnail(cfg(), { sha256: "b".repeat(64), storageKey: "bb/bb/x" }, 320);
    expect(result).toBeNull();
    throwOnRead = before;
  });
});
