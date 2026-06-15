import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { composeReady, parseReadyPhase, patchState, readState } from "./state";

describe("parseReadyPhase", () => {
  // LODE_INSTANCE itself contains a hyphen, so the phase must be parsed by
  // anchoring on the full instance prefix.
  const instance = "12345-abcdef";

  test("treats the bare token as serving (phase 0)", () => {
    expect(parseReadyPhase(instance, instance)).toBe(0);
  });

  test("parses the phased token suffix", () => {
    expect(parseReadyPhase(`${instance}-0`, instance)).toBe(0);
    expect(parseReadyPhase(`${instance}-1`, instance)).toBe(1);
    expect(parseReadyPhase(`${instance}-2`, instance)).toBe(2);
  });

  test("rejects out-of-range phases and foreign instances", () => {
    expect(parseReadyPhase(`${instance}-3`, instance)).toBeNull();
    expect(parseReadyPhase(`${instance}-x`, instance)).toBeNull();
    expect(parseReadyPhase("99999-zzzz-0", instance)).toBeNull();
  });

  test("returns null for missing inputs", () => {
    expect(parseReadyPhase(undefined, instance)).toBeNull();
    expect(parseReadyPhase(`${instance}-0`, undefined)).toBeNull();
  });
});

describe("composeReady", () => {
  test("joins instance and phase", () => {
    expect(composeReady("12345-abcdef", 0)).toBe("12345-abcdef-0");
    expect(composeReady("12345-abcdef", 2)).toBe("12345-abcdef-2");
  });
});

describe("patchState", () => {
  test("merges over existing fields and writes atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-state-"));
    try {
      const path = join(dir, "state.json");
      writeFileSync(path, JSON.stringify({ current: "1.0.0", status: "running", ready: null }));

      patchState(path, { ready: "inst-0" });

      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
        current: "1.0.0",
        status: "running",
        ready: "inst-0",
      });
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates the file when lode has not written it yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "bit-lode-state-"));
    try {
      const path = join(dir, "state.json");
      patchState(path, { ready: "inst-0" });
      expect(readState(path)).toEqual({ ready: "inst-0" });
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
