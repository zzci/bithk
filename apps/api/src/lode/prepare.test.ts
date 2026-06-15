import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { startLodePrepareWatcher } from "./prepare";

const INSTANCE = "12345-abcdef";

function readReady(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")).ready;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe("startLodePrepareWatcher", () => {
  test("is a no-op outside lode", () => {
    const watcher = startLodePrepareWatcher({ env: {}, onPrepare: () => {} });
    expect(typeof watcher.stop).toBe("function");
    watcher.stop();
  });

  test("runs onPrepare then acks phase 2 when lode prompts phase 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-prepare-"));
    const path = join(dir, "state.json");
    let prepared = false;
    // lode has prompted the staged-update prepare.
    writeFileSync(path, JSON.stringify({ current: "1.0.0", status: "updating", ready: `${INSTANCE}-1` }));

    const watcher = startLodePrepareWatcher({
      env: { LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE },
      intervalMs: 10,
      onPrepare: () => {
        prepared = true;
      },
    });

    try {
      await waitFor(() => readReady(path) === `${INSTANCE}-2`);
      expect(prepared).toBe(true);
      // Ack preserves lode's other fields.
      expect(JSON.parse(readFileSync(path, "utf-8")).current).toBe("1.0.0");
    }
    finally {
      watcher.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does nothing while serving (phase 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-prepare-"));
    const path = join(dir, "state.json");
    let prepared = false;
    writeFileSync(path, JSON.stringify({ ready: `${INSTANCE}-0` }));

    const watcher = startLodePrepareWatcher({
      env: { LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE },
      intervalMs: 10,
      onPrepare: () => {
        prepared = true;
      },
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(prepared).toBe(false);
      expect(readReady(path)).toBe(`${INSTANCE}-0`);
    }
    finally {
      watcher.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
