import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { getLodeSummary } from "./summary";

const INSTANCE = "12345-abcdef";

function withState(ready: unknown, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "bit-lode-summary-"));
  try {
    writeFileSync(join(dir, "state.json"), JSON.stringify({ current: "1.4.2", status: "running", ready }));
    fn(dir);
  }
  finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("getLodeSummary readiness", () => {
  test("reports not_configured without a data dir", () => {
    const summary = getLodeSummary({});
    expect(summary.status).toBe("not_configured");
    expect(summary.readiness).toEqual({ ready: null, phase: null });
  });

  test("derives readiness and phase from the phased token", () => {
    for (const [ready, phase] of [[`${INSTANCE}-0`, 0], [`${INSTANCE}-1`, 1], [`${INSTANCE}-2`, 2]] as const) {
      withState(ready, (dir) => {
        const summary = getLodeSummary({ LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE });
        expect(summary.status).toBe("available");
        expect(summary.current).toBe("1.4.2");
        expect(summary.readiness).toEqual({ ready: true, phase });
      });
    }
  });

  test("surfaces available version + last check/error from state.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-summary-"));
    try {
      writeFileSync(join(dir, "state.json"), JSON.stringify({
        current: "0.1.6",
        available: "0.1.7",
        status: "running",
        last_check: "2026-06-19T16:23:58Z",
        last_error: "update check: http status: 504",
        ready: `${INSTANCE}-0`,
      }));
      const s = getLodeSummary({ LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE });
      expect(s.current).toBe("0.1.6");
      expect(s.available).toBe("0.1.7");
      expect(s.lastCheckAt).toBe("2026-06-19T16:23:58Z");
      expect(s.lastError).toContain("504");
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts the bare legacy token as serving", () => {
    withState(INSTANCE, (dir) => {
      expect(getLodeSummary({ LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE }).readiness).toEqual({ ready: true, phase: 0 });
    });
  });

  test("treats a token for another instance as not ready", () => {
    withState("99999-zzzz-0", (dir) => {
      expect(getLodeSummary({ LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE }).readiness).toEqual({ ready: false, phase: null });
    });
  });

  test("reports null readiness when no ready value is present", () => {
    withState(null, (dir) => {
      expect(getLodeSummary({ LODE_DATA_DIR: dir, LODE_INSTANCE: INSTANCE }).readiness).toEqual({ ready: null, phase: null });
    });
  });
});
