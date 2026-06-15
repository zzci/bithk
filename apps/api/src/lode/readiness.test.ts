import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { markLodeReady } from "./readiness";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bit-lode-ready-"));
  try {
    await fn(dir);
  }
  finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("markLodeReady", () => {
  test("is a no-op outside lode", async () => {
    expect(await markLodeReady({ env: {} })).toBe(false);
  });

  test("reports serving as phase 0 and preserves lode's fields", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "state.json");
      writeFileSync(path, JSON.stringify({ current: "1.0.0", status: "running", ready: null }));

      const wrote = await markLodeReady({ env: { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-1" } });

      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
        current: "1.0.0",
        status: "running",
        ready: "inst-1-0",
      });
    });
  });

  test("creates state.json when lode has not written it yet", async () => {
    await withTempDir(async (dir) => {
      const wrote = await markLodeReady({ env: { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-2" } });
      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf-8"))).toEqual({ ready: "inst-2-0" });
    });
  });

  test("does not report ready when the probe is not satisfied", async () => {
    await withTempDir(async (dir) => {
      const wrote = await markLodeReady({
        env: { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-3" },
        probe: () => false,
      });
      expect(wrote).toBe(false);
      expect(existsSync(join(dir, "state.json"))).toBe(false);
    });
  });

  test("does not report ready when the probe throws", async () => {
    await withTempDir(async (dir) => {
      const wrote = await markLodeReady({
        env: { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-4" },
        probe: () => {
          throw new Error("db down");
        },
      });
      expect(wrote).toBe(false);
      expect(existsSync(join(dir, "state.json"))).toBe(false);
    });
  });

  test("reports ready when the probe is satisfied", async () => {
    await withTempDir(async (dir) => {
      const wrote = await markLodeReady({
        env: { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-5" },
        probe: async () => true,
      });
      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf-8"))).toEqual({ ready: "inst-5-0" });
    });
  });
});
