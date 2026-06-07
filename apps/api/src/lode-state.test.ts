import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { markLodeReady } from "./lode-state";

describe("markLodeReady", () => {
  test("is a no-op outside lode", () => {
    const wrote = markLodeReady(undefined, {});

    expect(wrote).toBe(false);
  });

  test("preserves lode state fields and sets ready to the current instance", () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-state-"));
    try {
      const statePath = join(dir, "state.json");
      writeFileSync(statePath, JSON.stringify({ current: "1.0.0", status: "running", ready: null }));

      const wrote = markLodeReady(undefined, { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-1" });

      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(statePath, "utf-8"))).toEqual({
        current: "1.0.0",
        status: "running",
        ready: "inst-1",
      });
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates state.json if lode has not written it yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-state-"));
    try {
      const wrote = markLodeReady(undefined, { LODE_DATA_DIR: dir, LODE_INSTANCE: "inst-2" });

      expect(wrote).toBe(true);
      expect(existsSync(join(dir, "state.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf-8"))).toEqual({ ready: "inst-2" });
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
